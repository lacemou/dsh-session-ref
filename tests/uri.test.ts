import { describe, expect, it } from 'vitest'
import {
  encodeSessionReferenceUri,
  formatSessionReferenceMention,
} from '../src/client/CopyReferenceButton.tsx'
import {
  encodeSessionReferenceUri as nativeEncode,
  parseSessionReferenceText,
} from '@deepseek-ai/dsh-session-reference'

describe('client URI encoding (must match the native encoder byte-for-byte)', () => {
  const ids = ['target-session-123', '会话-中文-id', 'a/b+c=d', 'uuid-like-9f8e7d6c-5b4a-3210-zyxw']

  it.each(ids)('encodes %s identically to the native encoder', (id) => {
    expect(encodeSessionReferenceUri(id)).toBe(nativeEncode(id))
  })

  it('produces a mention the native parser resolves with the label intact', () => {
    const mention = formatSessionReferenceMention('target-session-123', '目标会话A')
    expect(mention).toMatch(/^@\[目标会话A\]\(dsh-session:[A-Za-z0-9_-]+\)$/)
    const parsed = parseSessionReferenceText(`帮我看看 ${mention} 里做了什么`)
    expect(parsed.references).toEqual([{ sessionId: 'target-session-123', label: '目标会话A' }])
    expect(parsed.text).toBe('帮我看看 @目标会话A 里做了什么')
  })

  it('falls back to the session id as label when absent', () => {
    const mention = formatSessionReferenceMention('sess-9', '')
    expect(mention).toMatch(/^@\[sess-9\]\(dsh-session:/)
  })

  it('escapes bracket characters in the label', () => {
    const mention = formatSessionReferenceMention('sess-9', 'a[b]c')
    // Native parser must still extract the reference.
    const parsed = parseSessionReferenceText(mention)
    expect(parsed.references[0]?.sessionId).toBe('sess-9')
  })
})
