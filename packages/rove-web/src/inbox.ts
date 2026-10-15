/**
 * Inbox item → glyph, tone and state word, the TUI's vocabulary
 * (`tui-react/workspace/inbox-item-view.ts`) so a rate limit and a crash
 * read differently here too.
 */

import type { Tone } from "./rail.ts"

export interface InboxBadge {
  readonly glyph: string
  readonly tone: Tone
  /** i18n key under `inbox.state.*`. */
  readonly stateKey: string
}

export function inboxBadge(state: string): InboxBadge {
  switch (state) {
    case "permission_needed":
      return { glyph: "?", tone: "warning", stateKey: "inbox.state.needsInput" }
    case "turn_complete":
      return { glyph: "✓", tone: "success", stateKey: "inbox.state.done" }
    case "rate_limited":
      return { glyph: "◷", tone: "warning", stateKey: "inbox.state.rateLimited" }
    case "dead":
      return { glyph: "†", tone: "attention", stateKey: "inbox.state.dead" }
    case "routine_failed":
      return { glyph: "↻", tone: "attention", stateKey: "inbox.state.routineFailed" }
    case "routine_responded":
      return { glyph: "✓", tone: "success", stateKey: "inbox.state.routineResponded" }
    default:
      return { glyph: "!", tone: "attention", stateKey: "inbox.state.error" }
  }
}

/** `3m`, `2h`, `4d`: the TUI's compact age. */
export function compactAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}
