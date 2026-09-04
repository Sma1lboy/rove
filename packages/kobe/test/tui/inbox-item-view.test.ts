/**
 * Inbox card presentation — the glyph/word/resume-note mapping.
 *
 * The `resumesAt` case is the one that matters: `Task.quotaResume.resumeAt`
 * was persisted by the daemon and read by NOTHING, so "rate limited" could
 * not be told apart from "stuck forever". Deleting the `quotaResumeNote` call
 * in `AttentionInboxPane` is caught by the pane test; deleting the function's
 * body is caught here.
 */
import { describe, expect, it } from "vitest"
import {
  deferredPromptNote,
  itemGlyph,
  itemStateKey,
  quotaResumeNote,
} from "../../src/tui-react/workspace/inbox-item-view"
import type { Task } from "../../src/types/task"

const t = (key: string, params?: Record<string, string>) => (params ? `${key}:${Object.values(params).join(",")}` : key)
const armed = (resumeAt: string) => ({ quotaResume: { resumeAt } }) as Pick<Task, "quotaResume">

describe("quotaResumeNote", () => {
  it("names the armed resume time for a rate-limited task", () => {
    const note = quotaResumeNote("rate_limited", armed("2026-08-30T15:14:00.000Z"), t)
    expect(note).not.toBeNull()
    expect(note).toContain("workspace.inbox.resumesAt")
    // The formatted clock, not the raw ISO stamp.
    expect(note).not.toContain("2026-08-30T15:14")
    expect(note).toMatch(/\d{1,2}:\d{2}/)
  })

  it("says nothing when no resume is armed, or the state is not a rate limit", () => {
    expect(quotaResumeNote("rate_limited", { quotaResume: undefined }, t)).toBeNull()
    expect(quotaResumeNote("error", armed("2026-08-30T15:14:00.000Z"), t)).toBeNull()
    expect(quotaResumeNote("dead", armed("2026-08-30T15:14:00.000Z"), t)).toBeNull()
  })

  it("shows nothing rather than 'Invalid Date' for a garbage stamp", () => {
    expect(quotaResumeNote("rate_limited", armed("not-a-date"), t)).toBeNull()
  })
})

describe("inbox item glyphs", () => {
  it("gives a dead engine its own mark and word", () => {
    expect(itemGlyph("dead")).toBe("†")
    expect(itemStateKey("dead")).toBe("workspace.inbox.state.dead")
  })

  it("keeps rate limited distinct from error", () => {
    expect(itemGlyph("rate_limited")).not.toBe(itemGlyph("error"))
    expect(itemStateKey("rate_limited")).not.toBe(itemStateKey("error"))
  })
})

describe("deferredPromptNote", () => {
  // The API half has always been honest — `rove api deferred-list` publishes
  // `expiresAt` and says outright that "a swept prompt is never delivered".
  // The screen half showed `≡ message queued` and a relative age, so a row an
  // hour from destruction looked exactly like one filed a minute ago; then the
  // row was simply absent. These two notes are that missing half.
  const now = Date.UTC(2026, 8, 4, 12, 0, 0)
  const queued = (expiresAt?: number) => ({
    state: "prompt_deferred" as const,
    detail: { deferredPrompt: { id: "d1", layer: "composer-not-empty" as const, ...(expiresAt ? { expiresAt } : {}) } },
  })

  it("counts down to the deadline the daemon actually stored", () => {
    expect(deferredPromptNote(queued(now + 47 * 60_000), now, t)).toBe("workspace.inbox.expiresIn:47m")
    expect(deferredPromptNote(queued(now + 23 * 3_600_000), now, t)).toBe("workspace.inbox.expiresIn:23h")
  })

  it("says 'expiring' rather than a negative countdown once the deadline passes", () => {
    // The sweep ticks hourly, so a record can sit past its TTL and still be
    // there — "due, waiting for the next pass" is the honest reading.
    expect(deferredPromptNote(queued(now - 60_000), now, t)).toBe("workspace.inbox.expiringNow")
  })

  it("shows no deadline at all for an episode written before `expiresAt` existed", () => {
    // A guessed deadline would be worse than none: the episode's own `at` is
    // when the POINTER was written, which the crash-recovery path in
    // `automation-dispatch` re-stamps long after the text was filed.
    expect(deferredPromptNote(queued(), now, t)).toBeNull()
  })

  it("gives an expired message its own mark, word and epitaph", () => {
    expect(deferredPromptNote({ state: "prompt_expired", detail: {} }, now, t)).toBe("workspace.inbox.expiredNote")
    expect(itemGlyph("prompt_expired")).not.toBe(itemGlyph("prompt_deferred"))
    expect(itemStateKey("prompt_expired")).toBe("workspace.inbox.state.promptExpired")
  })

  it("says nothing about states that have no deadline", () => {
    expect(deferredPromptNote({ state: "rate_limited" }, now, t)).toBeNull()
    expect(deferredPromptNote({ state: "dead" }, now, t)).toBeNull()
  })
})
