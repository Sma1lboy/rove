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
import { itemGlyph, itemStateKey, quotaResumeNote } from "../../src/tui-react/workspace/inbox-item-view"
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
