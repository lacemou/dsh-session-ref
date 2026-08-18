/**
 * Composer tool-row button that copies a session-reference mention for the
 * CURRENT session into the clipboard: `@[label](dsh-session:<payload>)`.
 * Pasting that mention into any other session (including one in another
 * workspace) makes the host half resolve and inject the referenced snapshot.
 *
 * The base64url payload is produced here without any harness import (the
 * client bundle purity gate only allows loader module-table value imports) and
 * matches the native `encodeSessionReferenceUri` byte-for-byte:
 * `dsh-session:<base64url(JSON.stringify(sessionId))>`.
 */

import { createElement, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Inject face delivered by the slot registration (see client/index.ts). */
export interface CopyInject {
  /** Copy the current session's reference mention; resolves true on success. */
  readonly copy: () => Promise<boolean>
}

/** Canonical base64url payload, matching the native URI encoder. */
export function encodeSessionReferenceUri(sessionId: string): string {
  const json = JSON.stringify(sessionId)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const base64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `dsh-session:${base64}`
}

/** Render a host-neutral Markdown mention (label → sessionId fallback). */
export function formatSessionReferenceMention(sessionId: string, label: string): string {
  const resolved = label === '' ? sessionId : label
  const safe = resolved.replace(/([\\\]])/g, '\\$1')
  return `@[${safe}](${encodeSessionReferenceUri(sessionId)})`
}

const styles = {
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    border: '1px solid rgba(127, 127, 127, .35)',
    borderRadius: 6,
    background: 'transparent',
    color: 'inherit',
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
    whiteSpace: 'nowrap',
  } as const,
}

/** Tool-row button: click → copy mention → brief "copied" feedback. */
export function CopyReferenceButton({ copy }: PropsRuntime<'conversation.input.left'> & CopyInject): ReactElement {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const onClick = (): void => {
    void copy().then((ok) => {
      window.clearTimeout(timer.current)
      if (ok) {
        setCopied(true)
        timer.current = window.setTimeout(() => setCopied(false), 1500)
      }
    })
  }

  return createElement(
    'button',
    {
      type: 'button',
      style: styles.button,
      onClick,
      title: '复制本会话的跨会话引用（粘贴到其他会话即可引用本对话）',
      'aria-label': '复制会话引用',
    },
    copied ? '已复制 ✓' : '复制引用',
  )
}
