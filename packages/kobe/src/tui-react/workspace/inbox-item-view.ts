/**
 * Attention-Inbox item → presentation (glyph, tone, state word, resume note).
 * The vocabulary must MATCH the sidebar rail (`row-view.ts`) and tab strip
 * (`tab-strip.tsx`), or a rate limit and a crash look alike.
 */

import { intlLocale } from "@/tui/i18n"
import type { Task } from "@/types/task"
import type { RGBA } from "@opentui/core"
import type { AttentionInboxItem } from "@sma1lboy/kobe-daemon/daemon/contracts"

type ThemeColors = { warning: RGBA; success: RGBA; error: RGBA }

export function itemColor(state: AttentionInboxItem["state"], theme: ThemeColors): RGBA {
  if (state === "permission_needed") return theme.warning
  if (state === "turn_complete") return theme.success
  if (state === "rate_limited") return theme.warning
  return theme.error
}

export function itemGlyph(state: AttentionInboxItem["state"]): string {
  if (state === "permission_needed") return "?"
  if (state === "turn_complete") return "✓"
  // Not `⌛`: U+231B resolves to AppleColorEmoji on macOS, a 2.13-cell glyph in a 1-cell column.
  if (state === "rate_limited") return "◷"
  // The engine PROCESS is gone (DEAD_GLYPH).
  if (state === "dead") return "†"
  // A schedule that could not do its work — `↻`, a cycle that keeps failing.
  if (state === "routine_failed") return "↻"
  // A routine run answered — same done mark as a finished turn.
  if (state === "routine_responded") return "✓"
  return "!"
}

/** i18n key for the state word shown next to the glyph. */
export function itemStateKey(state: AttentionInboxItem["state"]): string {
  if (state === "permission_needed") return "workspace.inbox.state.needsInput"
  if (state === "turn_complete") return "workspace.inbox.state.done"
  if (state === "rate_limited") return "workspace.inbox.state.rateLimited"
  if (state === "dead") return "workspace.inbox.state.dead"
  if (state === "routine_failed") return "workspace.inbox.state.routineFailed"
  if (state === "routine_responded") return "workspace.inbox.state.routineResponded"
  return "workspace.inbox.state.error"
}

/**
 * "resumes 3:14 PM" from `Task.quotaResume.resumeAt`. Null unless
 * `rate_limited` with a parseable stamp (never "Invalid Date"). A past time
 * still shows: the resume runner ticks on an interval, so it's "due".
 */
export function quotaResumeNote(
  state: AttentionInboxItem["state"],
  task: Pick<Task, "quotaResume"> | undefined,
  t: (key: string, params?: Record<string, string>) => string,
): string | null {
  if (state !== "rate_limited") return null
  const raw = task?.quotaResume?.resumeAt
  if (!raw) return null
  const at = Date.parse(raw)
  if (!Number.isFinite(at)) return null
  return t("workspace.inbox.resumesAt", {
    // UI locale, not the OS's: the sentence around it is translated.
    time: new Date(at).toLocaleTimeString(intlLocale(), { hour: "numeric", minute: "2-digit" }),
  })
}
