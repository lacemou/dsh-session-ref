/**
 * dsh-session-ref — browser half.
 *
 * Registers the "复制引用" button in the composer tool row
 * (`conversation.input.left`). Clicking it copies a session-reference mention
 * for the current session — `@[label](dsh-session:<payload>)` — into the
 * clipboard. The label comes from the sessions list snapshot
 * (`SessionSummary.displayTitle`: durable title → project basename → session
 * id), read at click time so it is always current.
 *
 * Cross-cohort note (0.2.0): the client bundle keeps zero value imports from
 * host packages — only `react` is required at runtime — so the same artifact
 * loads on 0.1.x hosts (where `sessions` comes from dsh-client-runtime) and
 * on 0.1.2+ hosts (where it comes from dsh-api-session-controller). All
 * `@deepseek-ai/*` references are type-only and erased at build; type sources
 * point at the 0.1.2-rc.1 cohort (api-session-controller ISessions,
 * dsh-session SessionId, ui-slots PropsRuntime). The `dsh.client.inject`
 * manifest list is intentionally empty: a phantom `dsh-client-runtime` entry
 * there is fatal on 0.1.2 hosts (DSH-0.1.2-A1-25), and the bundle
 * value-requires only platform seeds.
 */

import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { CopyReferenceButton, formatSessionReferenceMention } from './CopyReferenceButton.tsx'
import type { CopyInject } from './CopyReferenceButton.tsx'

export const inject = ['slots', 'sessions']

/**
 * Structural client context shared by 0.1.x and 0.1.2+ hosts. The cordis
 * Context augmentations (which package owns `slots` / `sessions`) differ per
 * cohort, so the plugin types only the surface it actually touches. The
 * runtime object shapes are identical across cohorts — the built-in composer
 * and conversation entries use the same `ctx.slots.inject/register` and
 * `ctx.get('sessions')` calls on every supported host.
 */
export interface ClientContext {
  get<T = unknown>(name: string, strict?: boolean): T | undefined
  slots: {
    inject(name: string, provider: () => unknown): unknown
    register(
      options: {
        name: string
        id: string
        order?: number
        inject: (sessionId: SessionId) => CopyInject
      },
      component: unknown,
    ): unknown
  }
}

/**
 * Read the current display label of one session from the root sessions
 * service. Structural across cohorts: 0.1.x (`ISessions.list`) and 0.1.2+
 * (`sessions.list`) expose the same snapshot store shape
 * (`byId[id].displayTitle`). Missing summary falls back to the session id.
 */
function labelOf(ctx: ClientContext, sessionId: SessionId): string {
  const sessions = ctx.get<ISessions | undefined>('sessions')
  const state = sessions?.list?.getSnapshot?.()
  const summary = state?.byId?.[sessionId]
  return summary?.displayTitle ?? summary?.title ?? String(sessionId)
}

/** Build the click-time copy action for one session. */
function copyInject(ctx: ClientContext, sessionId: SessionId): CopyInject {
  const copy = async (): Promise<boolean> => {
    const mention = formatSessionReferenceMention(String(sessionId), labelOf(ctx, sessionId))
    try {
      await navigator.clipboard.writeText(mention)
      return true
    } catch {
      // Clipboard API unavailable (non-secure context): fall back to a
      // temporary textarea + execCommand.
      try {
        const textarea = document.createElement('textarea')
        textarea.value = mention
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        const ok = document.execCommand('copy')
        textarea.remove()
        return ok
      } catch {
        console.error('[session-ref] copy failed:', mention)
        return false
      }
    }
  }
  return { copy }
}

/** Client plugin body: composer tool-row trigger. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    { name: 'conversation.input.left', id: 'session-ref-copy', order: 10, inject: (sessionId: SessionId) => copyInject(ctx, sessionId) },
    CopyReferenceButton,
  ))
}
