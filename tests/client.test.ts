import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

/** Minimal clipboard stub; installs a configurable navigator.clipboard. */
function installClipboard(impl?: (text: string) => Promise<void>) {
  const writes: string[] = []
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      clipboard: {
        writeText: impl ?? (async (text: string) => { writes.push(text) }),
      },
    },
    configurable: true,
    writable: true,
  })
  return writes
}

function installExecFallback() {
  let execCopied = ''
  Object.defineProperty(globalThis, 'document', {
    value: {
      createElement: () => ({
        style: {},
        select() {},
        remove() {},
        set value(v: string) { execCopied = v },
      }),
      execCommand: () => true,
      body: { appendChild() {} },
    },
    configurable: true,
    writable: true,
  })
  return () => execCopied
}

function setupClient(byId: Record<string, { displayTitle?: string }>) {
  let registered: { name: string; opts: { inject: (id: string) => unknown } } | null = null
  const ctx = {
    get(service: string) {
      if (service === 'sessions') {
        return {
          list: { getSnapshot: () => ({ byId }) },
        }
      }
      return undefined
    },
    slots: {
      inject(name: string, fn: () => unknown) {
        registered = { name, opts: (fn() as { opts: { inject: (id: string) => unknown } }).opts }
      },
      register(opts: { inject: (id: string) => unknown }, _component: unknown) {
        return { opts }
      },
    },
  }
  apply(ctx as never)
  return registered
}

describe('client half: composer trigger', () => {
  afterEach(() => {
    // Restore pristine globals for the next test.
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true })
    Object.defineProperty(globalThis, 'document', { value: undefined, configurable: true })
  })

  it('registers a button in conversation.input.left', () => {
    const registered = setupClient({ 'sess-1': { displayTitle: '我的会话' } })
    expect(registered?.name).toBe('conversation.input.left')
  })

  it('copies @[label](dsh-session:…) with the session display title', async () => {
    const writes: string[] = []
    installClipboard(async (t) => { writes.push(t) })
    const registered = setupClient({ 'sess-1': { displayTitle: '我的会话' } })
    const inject = registered?.opts.inject('sess-1') as { copy: () => Promise<boolean> }
    const ok = await inject.copy()
    expect(ok).toBe(true)
    expect(writes[0]).toBe('@[我的会话](dsh-session:InNlc3MtMSI)')
  })

  it('copies a mention the native parser resolves to the right session', async () => {
    const writes: string[] = []
    installClipboard(async (t) => { writes.push(t) })
    const registered = setupClient({ 'sess-1': { displayTitle: '我的会话' } })
    const inject = registered?.opts.inject('sess-1') as { copy: () => Promise<boolean> }
    await inject.copy()
    expect(writes).toHaveLength(1)
    const { parseSessionReferenceText } = await import('@deepseek-ai/dsh-session-reference')
    const parsed = parseSessionReferenceText(writes[0])
    expect(parsed.references).toEqual([{ sessionId: 'sess-1', label: '我的会话' }])
  })

  it('falls back to the session id when the title is missing', async () => {
    const writes: string[] = []
    installClipboard(async (t) => { writes.push(t) })
    const registered = setupClient({ 'sess-2': {} })
    const inject = registered?.opts.inject('sess-2') as { copy: () => Promise<boolean> }
    await inject.copy()
    expect(writes[0]).toContain('@[sess-2](')
  })

  it('uses the execCommand fallback when the clipboard API fails', async () => {
    installClipboard(async () => { throw new Error('denied') })
    const readExec = installExecFallback()
    const registered = setupClient({ 'sess-1': { displayTitle: '我的会话' } })
    const inject = registered?.opts.inject('sess-1') as { copy: () => Promise<boolean> }
    const ok = await inject.copy()
    expect(ok).toBe(true)
    expect(readExec()).toContain('dsh-session:')
  })
})
