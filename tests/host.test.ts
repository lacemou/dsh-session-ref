import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import type { PreStepPayload } from '../src/index.ts'

/** Native-compatible base64url payload for a session id. */
function encodeUri(sessionId: string): string {
  return `dsh-session:${Buffer.from(JSON.stringify(sessionId)).toString('base64url')}`
}

interface HostHarness {
  /** The registered pre-step listener (null when apply did not register). */
  listener: ((payload: PreStepPayload, next: () => Promise<unknown>) => Promise<unknown>) | null
  /** The prepare mock, inspectable via mock.calls. */
  prepare: ReturnType<typeof vi.fn>
  /** Replace the prepare implementation (failure-path tests). */
  setPrepare(impl: (agent: unknown, content: unknown, references: unknown) => Promise<unknown>): void
}

function setup(): HostHarness {
  let listener: HostHarness['listener'] = null
  const prepare = vi.fn(async (_agent: unknown, content: unknown, _references: unknown) => ({
    content,
    additionalContext: {
      role: 'user',
      content: [{ type: 'text', text: '## Referenced sessions snapshot' }],
      source: { kind: 'session-reference', form: 'recall', version: 1, references: [] },
    },
  }))
  const ctx = {
    sessionReferenceResolver: { prepare },
    on(_event: string, fn: (typeof listener), _opts?: { prepend?: boolean }) {
      listener = fn
    },
  }
  apply(ctx as never)
  return {
    listener,
    prepare,
    setPrepare(impl) {
      prepare.mockImplementation(impl as never)
    },
  }
}

const userMessage = (text: string) => ({ role: 'user', content: [{ type: 'text', text }] })

async function run(listener: HostHarness['listener'], payload: PreStepPayload, decision: unknown) {
  if (listener === null) throw new Error('listener not registered')
  return listener(payload, async () => decision)
}

describe('host half: agent/pre-step', () => {
  it('registers the listener with prepend semantics', () => {
    let captured: { prepend?: boolean } | undefined
    const ctx = {
      sessionReferenceResolver: { prepare: vi.fn() },
      on(_e: string, _fn: unknown, opts?: { prepend?: boolean }) { captured = opts },
    }
    apply(ctx as never)
    expect(captured?.prepend).toBe(true)
  })

  it('resolves a mention, rewrites it to @label, and injects recall before the direct message', async () => {
    const { listener, prepare } = setup()
    const uri = encodeUri('target-session-123')
    const claimed = [userMessage(`帮我看看 @[目标会话](${uri}) 里做了什么`)]
    const out = await run(listener, {
      agent: { session: { id: 'self-session' } },
      messages: claimed as never,
      signal: new AbortController().signal,
    }, { kind: 'enter', messages: claimed })
    expect(out).toMatchObject({ kind: 'enter' })
    const messages = (out as { messages: { source?: { kind?: string }; content: { text: string }[] }[] }).messages
    expect(messages).toHaveLength(2)
    expect(messages[0].source?.kind).toBe('session-reference') // recall first
    expect(messages[1].content[0].text).toBe('帮我看看 @目标会话 里做了什么') // readable label
    expect(prepare).toHaveBeenCalledTimes(1)
    const refs = prepare.mock.calls[0][2]
    expect(refs).toEqual([{ sessionId: 'target-session-123', label: '目标会话' }])
  })

  it('passes messages through untouched when there is no mention', async () => {
    const { listener, prepare } = setup()
    const claimed = [userMessage('普通消息')]
    const out = await run(listener, {
      agent: { session: { id: 'self' } },
      messages: claimed as never,
      signal: new AbortController().signal,
    }, { kind: 'enter', messages: claimed })
    expect(out).toMatchObject({ kind: 'enter', messages: claimed })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('passes a reject decision through untouched', async () => {
    const { listener, prepare } = setup()
    const out = await run(listener, {
      agent: { session: { id: 'self' } },
      messages: [userMessage('x')] as never,
      signal: new AbortController().signal,
    }, { kind: 'reject' })
    expect(out).toEqual({ kind: 'reject' })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('keeps the raw mention when prepare fails (never blocks the turn)', async () => {
    const { listener, setPrepare } = setup()
    setPrepare(async () => { throw new Error('SESSION_REFERENCE_READ_FAILED') })
    const uri = encodeUri('broken-session')
    const claimed = [userMessage(`@[坏的](${uri}) 引用失败`) ]
    const out = await run(listener, {
      agent: { session: { id: 'self' } },
      messages: claimed as never,
      signal: new AbortController().signal,
    }, { kind: 'enter', messages: claimed })
    const messages = (out as { messages: { content: { text: string }[] }[] }).messages
    expect(messages).toHaveLength(1)
    expect(messages[0].content[0].text).toContain(`@[坏的](${uri})`) // raw mention preserved
  })

  it('injects one recall per message, each before its own direct message', async () => {
    const { listener } = setup()
    const uriA = encodeUri('sess-a')
    const uriB = encodeUri('sess-b')
    const claimed = [
      userMessage(`引用 A：@[A](${uriA})`),
      userMessage(`引用 B：@[B](${uriB})`),
    ]
    const out = await run(listener, {
      agent: { session: { id: 'self' } },
      messages: claimed as never,
      signal: new AbortController().signal,
    }, { kind: 'enter', messages: claimed })
    const messages = (out as { messages: { source?: { kind?: string }; content: { text: string }[] }[] }).messages
    expect(messages).toHaveLength(4)
    expect(messages[0].source?.kind).toBe('session-reference')
    expect(messages[1].content[0].text).toBe('引用 A：@A')
    expect(messages[2].source?.kind).toBe('session-reference')
    expect(messages[3].content[0].text).toBe('引用 B：@B')
  })

  it('handles aborted signals without injecting', async () => {
    const { listener, prepare } = setup()
    const controller = new AbortController()
    controller.abort()
    const claimed = [userMessage('x')]
    const out = await run(listener, {
      agent: { session: { id: 'self' } },
      messages: claimed as never,
      signal: controller.signal,
    }, { kind: 'enter', messages: claimed })
    expect(out).toMatchObject({ kind: 'enter', messages: claimed })
    expect(prepare).not.toHaveBeenCalled()
  })
})
