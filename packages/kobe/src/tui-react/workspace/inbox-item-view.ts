/**
 * Attention-Inbox item → its presentation (glyph, tone, state word, and the
 * rate-limit resume note). Pure and framework-free, kept out of
 * `AttentionInboxPane.tsx` so the mapping is unit-testable without mounting
 * the pane — which matters more here than usual, because of the rule below.
 *
 * One rule holds the four together: the Inbox's vocabulary must MATCH the
 * sidebar rail's (`row-view.ts`) and the tab strip's (`tab-strip.tsx`). Three
 * surfaces describing one tab in three vocabularies is what makes a rate
 * limit and a crash look identical.
 */

import { relativeCountdown } from "@/lib/relative-time"
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
  // `◷`, the sidebar's rate-limited glyph, deliberately not `⌛`: U+231B
  // carries the Unicode Emoji property, so macOS resolves it to
  // AppleColorEmoji — a 2.13-cell colour glyph in a 1-cell column, which both
  // overflows and breaks the pane's monochrome ink.
  if (state === "rate_limited") return "◷"
  // `†` — the engine PROCESS is gone, the sidebar rail's DEAD_GLYPH.
  if (state === "dead") return "†"
  // A schedule that could not do its work — `↻`, a cycle that keeps failing.
  if (state === "routine_failed") return "↻"
  return "!"
}

/** i18n key for the state word shown next to the glyph. */
export function itemStateKey(state: AttentionInboxItem["state"]): string {
  if (state === "permission_needed") return "workspace.inbox.state.needsInput"
  if (state === "turn_complete") return "workspace.inbox.state.done"
  if (state === "rate_limited") return "workspace.inbox.state.rateLimited"
  if (state === "dead") return "workspace.inbox.state.dead"
  if (state === "routine_failed") return "workspace.inbox.state.routineFailed"
  return "workspace.inbox.state.error"
}

/**
 * "resumes 3:14 PM" for a rate-limited task whose auto-resume is armed, in the
 * viewer's locale clock. The daemon persists `Task.quotaResume.resumeAt` when
 * the engine's quota probe answers when the window clears (quota-resume.ts).
 * Showing it is what lets a user tell "back at 3:14, already scheduled" from
 * "stuck, go do something else".
 *
 * Null unless the state is `rate_limited` (the only state the schedule
 * describes), the task carries a schedule, and its stamp parses — a garbage
 * timestamp shows nothing rather than "Invalid Date". A time already past is
 * still shown: the resume runner ticks on an interval, so "due, waiting for
 * the next sweep" is the honest reading, not "never".
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
    // The UI locale, not the machine's: the sentence around this clock is
    // translated, so an OS-locale clock inside it is a seam the user sees.
    time: new Date(at).toLocaleTimeString(intlLocale(), { hour: "numeric", minute: "2-digit" }),
  })
}
