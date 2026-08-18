/**
 * dsh-session-ref — browser half.
 *
 * Registers the "复制引用" button in the composer tool row
 * (`conversation.input.left`). Clicking it copies a session-reference mention
 * for the current session — `@[label](dsh-session:<payload>)` — into the
 * clipboard. The label comes from the sessions list snapshot
 * (`SessionSummary.displayTitle`: durable title → project basename → session
 * id), read at click time so it is always current.
 */

import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { CopyReferenceButton, formatSessionReferenceMention } from './CopyReferenceButton.tsx'
import type { CopyInject } from './CopyReferenceButton.tsx'

export const inject = ['slots', 'sessions']

/** Build the click-time copy action for one session. */
function copyInject(ctx: ClientContext, sessionId: SessionId): CopyInject {
  const copy = async (): Promise<boolean> => {
    const sessions = ctx.get('sessions') as ISessions | undefined
    const state = sessions?.list.getSnapshot()
    const label = state?.byId[sessionId]?.displayTitle ?? String(sessionId)
    const mention = formatSessionReferenceMention(String(sessionId), label)
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
    { name: 'conversation.input.left', id: 'session-ref-copy', inject: (sessionId: SessionId) => copyInject(ctx, sessionId) },
    CopyReferenceButton,
  ))
}
