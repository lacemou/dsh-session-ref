/**
 * dsh-session-ref — host half.
 *
 * An `agent/pre-step` listener (prepend: true) that finds
 * `@[label](dsh-session:...)` mentions and bare `dsh-session:<id>` URIs in the
 * incoming prompt, hands the rewritten content and the structured references to
 * the native `sessionReferenceResolver.prepare()`, and returns an enter
 * decision that places each aggregated snapshot (`session-reference` recall
 * context) directly before its rewritten direct message.
 *
 * Everything cross-session is native: parallel source reads, dedup, budget
 * bounds, self-reference rejection, and the untrusted-context warning come from
 * the harness core. This half is only the parse-and-inject shell. On any
 * prepare failure the message passes through untouched (the mention stays
 * visible to the model) and the error is logged — a user turn is never blocked.
 *
 * The `sessionReferenceResolver` service is optional in DSH deployments: the
 * package ships in the dependency tree, but rc.6 profiles do not mount the
 * service. This plugin therefore registers it on the root context when absent
 * (idempotent; if a future host already provides it, the existing instance
 * wins), then reads it from the root so the pre-step listener never depends on
 * the plugin fiber's inject timing.
 */

import { parseSessionReferenceText, SessionReferenceResolver } from '@deepseek-ai/dsh-session-reference'
import type { SessionReferenceInput } from '@deepseek-ai/dsh-session-reference'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'

/** Structural stand-in for the cordis Context the Loader hands to apply(). */
export interface HostContext {
  readonly sessionReferenceResolver?: {
    prepare(
      agent: unknown,
      content: readonly ContentBlock[],
      references: readonly SessionReferenceInput[],
      signal?: AbortSignal,
    ): Promise<{ content: ContentBlock[]; additionalContext?: UserMessage }>
  }
  readonly root?: HostContext
  /** cordis store read without the inject requirement; undefined when not provided. */
  get?(name: string, strict?: boolean): unknown
  on(
    event: 'agent/pre-step',
    listener: (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>,
    options?: { prepend?: boolean },
  ): unknown
}

/** Plugin configuration (cordis.patch.yml `config:` under id `session-ref`). */
export interface HostConfig {
  maxReferences?: number
  candidateLimit?: number
  maxReferenceBytes?: number
}

/** Subset of the `agent/pre-step` payload this plugin reads. */
export interface PreStepPayload {
  readonly agent: { readonly session: { readonly id: string } }
  readonly messages: readonly { readonly content: readonly ContentBlock[] }[]
  readonly signal: AbortSignal
}

/**
 * Rewrite every text block of one message: parse mention-bearing blocks with
 * the native parser (readable `@label` text + structured references), keep
 * non-text blocks untouched. A malformed explicit mention makes the native
 * parser throw for that block — treat the block as ordinary text.
 */
function rewriteContent(content: readonly ContentBlock[]): {
  content: ContentBlock[]
  references: SessionReferenceInput[]
} {
  const references: SessionReferenceInput[] = []
  const blocks: ContentBlock[] = []
  for (const block of content) {
    if (block.type !== 'text') {
      blocks.push(block)
      continue
    }
    try {
      const parsed = parseSessionReferenceText(block.text)
      references.push(...parsed.references)
      blocks.push({ ...block, text: parsed.text })
    } catch {
      // Malformed mention: keep the raw block as ordinary discussion text.
      blocks.push(block)
    }
  }
  return { content: blocks, references }
}

/** Resolve the sessionReferenceResolver service from the root store. */
function readResolver(root: HostContext): HostContext['sessionReferenceResolver'] | undefined {
  if (root.get !== undefined) return root.get('sessionReferenceResolver', false) as HostContext['sessionReferenceResolver']
  return root.sessionReferenceResolver
}

/**
 * Register the pre-step listener and, when absent, the native resolver service.
 *
 * Hosts before rc.8 do not mount `sessionReferenceResolver`; this plugin
 * registers it (its bundle patch disables the native `session-reference` entry
 * on rc.8+ so this registration is the single owner). Detection uses the
 * cordis store API (`get(name, false)` — no inject requirement, any provider
 * regardless of fiber state) and the registration itself is race-tolerant: if
 * a concurrent provider (e.g. a host that re-enables the native entry) wins,
 * we fall back to whatever is registered and continue.
 */
export function apply(ctx: HostContext, config: HostConfig = {}): void {
  const root = ctx.root ?? ctx

  if (readResolver(root) === undefined) {
    try {
      new SessionReferenceResolver(root as never, {
        maxReferences: config.maxReferences,
        candidateLimit: config.candidateLimit,
        maxReferenceBytes: config.maxReferenceBytes,
      } as never)
    } catch (error) {
      // Race: another fiber registered the service between the check and the
      // registration. Fall back to the existing instance.
      console.warn('[session-ref] sessionReferenceResolver registration raced; using existing service', error)
    }
  }

  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision

    // References come from the raw event payload (first-mention order across
    // the claimed direct prompt); the output is rebuilt from the decision
    // messages so later listeners' edits survive.
    let anyReference = false
    for (const message of messages) {
      for (const block of message.content) {
        if (block.type !== 'text') continue
        try {
          if (parseSessionReferenceText(block.text).references.length > 0) anyReference = true
        } catch {
          // Malformed mention: ordinary text.
        }
      }
    }
    if (!anyReference) return decision

    const resolver = readResolver(root)
    if (resolver === undefined) {
      console.error('[session-ref] sessionReferenceResolver unavailable; skipping injection')
      return decision
    }

    const out: UserMessage[] = []
    for (const message of decision.messages) {
      const { content, references } = rewriteContent(message.content)
      if (references.length === 0) {
        out.push(message as UserMessage)
        continue
      }
      let prepared: { content: ContentBlock[]; additionalContext?: UserMessage }
      try {
        prepared = await resolver.prepare(
          agent,
          content,
          references,
          signal,
        )
      } catch (error) {
        // Budget exceeded / source unreadable / self reference / cancellation:
        // never block the turn — the raw mention stays in the direct message.
        console.error('[session-ref] prepare failed:', error)
        out.push(message as UserMessage)
        continue
      }
      if (prepared.additionalContext !== undefined) out.push(prepared.additionalContext)
      out.push({ ...(message as UserMessage), content: prepared.content })
    }

    return { kind: 'enter', messages: out }
  }, { prepend: true })
}
