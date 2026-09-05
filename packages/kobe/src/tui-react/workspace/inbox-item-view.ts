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
  if (state === "prompt_deferred") return theme.warning
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
  // `≡` (no Emoji property) for a queued message — a stack, not a failure.
  if (state === "prompt_deferred") return "≡"
  // `✕` (U+2715, no Emoji property either) — the stack that was thrown away.
  if (state === "prompt_expired") return "✕"
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
  if (state === "prompt_deferred") return "workspace.inbox.state.promptDeferred"
  if (state === "prompt_expired") return "workspace.inbox.state.promptExpired"
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

/**
 * The deadline half of a queued message, and the epitaph of one that missed it
 * — `quotaResumeNote`'s sibling, and for the same reason: a row that says only
 * "message queued — 23h" cannot be told from one that is fine, and this is the
 * single episode with a HARD expiry behind it. `rove api deferred-list` has
 * published `expiresAt` and documented that "a swept prompt is never
 * delivered" all along; this is the screen half of that promise.
 *
 * Null when the episode is neither, or when it predates `expiresAt` being
 * written — no deadline beats a guessed one. A deadline already past still
 * renders (the sweep ticks hourly, so "due, waiting for the next pass" is the
 * honest reading), exactly as {@link quotaResumeNote} treats a past resume.
 */
export function deferredPromptNote(
  item: Pick<AttentionInboxItem, "state" | "detail">,
  now: number,
  t: (key: string, params?: Record<string, string>) => string,
): string | null {
  if (item.state === "prompt_expired") return t("workspace.inbox.expiredNote")
  if (item.state !== "prompt_deferred") return null
  const at = item.detail?.deferredPrompt?.expiresAt
  if (at === undefined || !Number.isFinite(at)) return null
  return at <= now
    ? t("workspace.inbox.expiringNow")
    : t("workspace.inbox.expiresIn", { in: relativeCountdown(at, now) })
}

/**
 * The whole context line of a held/expired message: WHO sent it, WHICH check
 * held it, and HOW LONG the text survives.
 *
 * All three are the judgement a human makes before pressing `d`. The card used
 * to say "message queued — 23h" and nothing else, so dismissing was a coin
 * flip: the one real loss this file exists to prevent was a dispatcher's
 * instruction thrown away by someone who could not see it came from a
 * dispatcher. Sender comes off the record (lifted from the prompt's
 * `[ROVE PEER]` header when it filed), never from the prompt body — the
 * episode contract keeps the text in the daemon's store.
 *
 * Segments are dropped, not blanked, when unknown: a pre-`sender` episode
 * shows the fallback title and the reader learns nothing false.
 */
export function deferredPromptSubtitle(
  item: Pick<AttentionInboxItem, "state" | "detail">,
  fallbackTitle: string,
  now: number,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  const deferred = item.detail?.deferredPrompt
  const sender = deferred?.sender
  const parts = [sender ? t("workspace.inbox.from", { sender }) : fallbackTitle]
  if (deferred?.layer) {
    parts.push(
      t(deferred.layer === "recent-human-write" ? "workspace.inbox.layer.keystroke" : "workspace.inbox.layer.screen"),
    )
  }
  const note = deferredPromptNote(item, now, t)
  if (note) parts.push(note)
  return parts.filter((part) => part.length > 0).join(" · ")
}
