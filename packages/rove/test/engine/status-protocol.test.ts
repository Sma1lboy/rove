import {
  noteFilingProtocol,
  statusReportProtocol,
  withWorktreeProtocol,
  worktreeProtocol,
} from "@sma1lboy/rove-core/engine/worktree-protocol.ts"
import { describe, expect, it } from "vitest"

/**
 * Protocol injection (web-kanban.md M5).
 * Load-bearing: protocols ride `--append-system-prompt` ONLY for claude
 * launches of a known task with the relevant opt-in on; a custom command
 * that already sets the flag is never double-injected.
 */

const on = () => true
const off = () => false

describe("withWorktreeProtocol", () => {
  it("appends the flag + status protocol for an enabled claude launch", () => {
    const argv = withWorktreeProtocol(["claude"], "claude", "t1", { status: on, notes: off })
    expect(argv.slice(0, 2)).toEqual(["claude", "--append-system-prompt"])
    expect(argv[2]).toContain("task t1")
    // `update` is a TOP-LEVEL api verb — `edit` is only a schema-doc
    // grouping label, not a command path (a real agent hit BAD_VERB on it).
    expect(argv[2]).toContain("api update --task-id t1 --status in_review")
    expect(argv[2]).not.toContain("api edit")
  })

  it("composes status + note filing into ONE injection when both switches are on", () => {
    const argv = withWorktreeProtocol(["claude"], "claude", "t1", { status: on, notes: on })
    expect(argv.filter((a) => a === "--append-system-prompt")).toHaveLength(1)
    expect(argv[2]).toContain("api update --task-id t1")
    expect(argv[2]).toContain("api note --task-id t1")
  })

  it("notes-only works without the status switch", () => {
    const argv = withWorktreeProtocol(["claude"], "claude", "t1", { status: off, notes: on })
    expect(argv[2]).toContain("api note --task-id t1")
    expect(argv[2]).not.toContain("--status")
  })

  it("leaves the argv alone when nothing is enabled, vendor isn't claude, or no task", () => {
    expect(withWorktreeProtocol(["claude"], "claude", "t1", { status: off, notes: off })).toEqual(["claude"])
    expect(withWorktreeProtocol(["codex"], "codex", "t1", { status: on, notes: on })).toEqual(["codex"])
    expect(withWorktreeProtocol(["claude"], "claude", undefined, { status: on, notes: on })).toEqual(["claude"])
  })

  it("never double-injects over a custom command that sets the flag", () => {
    const custom = ["claude", "--append-system-prompt", "user's own"]
    expect(withWorktreeProtocol(custom, "claude", "t1", { status: on, notes: on })).toEqual(custom)
    const customFile = ["claude", "--append-system-prompt-file", "/tmp/p.txt"]
    expect(withWorktreeProtocol(customFile, "claude", "t1", { status: on, notes: on })).toEqual(customFile)
  })
})

describe("statusReportProtocol", () => {
  it("the api prefix is injectable — packaged builds bake plain `rove api`", () => {
    // The default resolves the environment's CLI invocation (the dev bun
    // line from a source checkout), so a protocol agent never drives a
    // stale global `rove` that predates a new verb and answers BAD_VERB.
    expect(statusReportProtocol("t9", "rove api")).toContain("rove api update --task-id t9")
    expect(noteFilingProtocol("t9", "rove api")).toContain('rove api note --task-id t9 --text "<one line')
  })

  it("points delegation at rove's own verbs — a pointer, not a curriculum", () => {
    // The injected protocol stays small (every session pays context for it):
    // the coordination verbs are named so the agent knows they exist, and the
    // schema/skill are named as where to learn them — nothing more.
    const text = noteFilingProtocol("t9", "rove api")
    expect(text).toContain("add --prompt, add --count N for parallel attempts, send, dispatch")
    expect(text).toContain("rove api schema")
    // Guard the "pointer" property itself: the whole protocol must stay a
    // handful of lines, not absorb the skill's verb tables over time.
    expect(text.split("\n").length).toBeLessThanOrEqual(6)
  })
})

describe("note recall", () => {
  const notes = [
    { text: "the build needs --no-sandbox", author: "worker A" },
    { text: "auth tests need a fresh keychain", author: "" },
  ]

  it("seeds an enabled session with the repo's accumulated notes, with provenance", () => {
    const text = worktreeProtocol("t1", "rove api", { status: off, notes: on }, notes)
    expect(text).toContain("the build needs --no-sandbox")
    expect(text).toContain('(from "worker A")')
    // An authorless note still renders, just without the attribution clause.
    expect(text).toContain("auth tests need a fresh keychain")
    // Notes are claims, not orders — the prompt must say so or a stale note
    // outranks what the session observes.
    expect(text).toContain("not instructions")
  })

  it("emits no recall block at all when the repo has no notes", () => {
    const text = worktreeProtocol("t1", "rove api", { status: off, notes: on }, [])
    expect(text).toContain("field notes")
    expect(text).not.toContain("previously filed by other sessions")
  })

  it("withholds recall when the note switch is off, even with notes on disk", () => {
    expect(worktreeProtocol("t1", "rove api", { status: on, notes: off }, notes)).not.toContain("--no-sandbox")
  })
})
