import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { parseWorktreeRemovePath, readTextWithTimeout } from "../../src/cli/hook-cmd.ts"

/**
 * `parseWorktreeRemovePath` is the removal-side mirror: the same global hook
 * archives the task pinned to a worktree the MOMENT `git worktree remove` runs.
 * It must find the path past `remove`'s (valueless) flags, ignore non-remove
 * commands, and never be fooled by a chained command.
 */
describe("parseWorktreeRemovePath", () => {
  it("returns undefined for commands that aren't a worktree-remove", () => {
    expect(parseWorktreeRemovePath("git status")).toBeUndefined()
    expect(parseWorktreeRemovePath("git worktree list")).toBeUndefined()
    expect(parseWorktreeRemovePath("git worktree add foo")).toBeUndefined()
  })

  it("extracts a bare path", () => {
    expect(parseWorktreeRemovePath("git worktree remove .claude/worktrees/lynx")).toBe(".claude/worktrees/lynx")
  })

  it("skips boolean flags like -f / --force", () => {
    expect(parseWorktreeRemovePath("git worktree remove -f ../wt")).toBe("../wt")
    expect(parseWorktreeRemovePath("git worktree remove --force /tmp/wt")).toBe("/tmp/wt")
  })

  it("strips quotes around the path", () => {
    expect(parseWorktreeRemovePath('git worktree remove "my worktrees/lynx"')).toBe("my worktrees/lynx")
  })

  it("finds the worktree remove inside a compound command", () => {
    expect(parseWorktreeRemovePath("cd /repo && git worktree remove -f wt")).toBe("wt")
  })

  it("stops at a shell operator so a chained command can't masquerade as the path", () => {
    expect(parseWorktreeRemovePath("git worktree remove -f && echo done")).toBeUndefined()
  })
})

/**
 * `readTextWithTimeout` is the stdin-race helper behind `readStdinPayload`. The
 * regression it pins (perf): the fallback timer was never cleared, so even when
 * stdin resolved instantly the process couldn't exit until the 500ms timer
 * fired — and `kobe hook` runs on every Bash tool call + turn boundary of every
 * Claude session machine-wide. The contract: when the reader wins the race, the
 * timer is cleared, so no pending timer is left to keep the event loop alive.
 */
describe("readTextWithTimeout timer hygiene", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("clears the fallback timer once the reader wins, leaving no pending timers", async () => {
    const result = await readTextWithTimeout(async () => "payload", 500)
    expect(result).toBe("payload")
    // The crux: if the 500ms timer were still pending, the count would be 1 and
    // the real process would idle-wait ~500ms after the work is done.
    expect(vi.getTimerCount()).toBe(0)
  })

  it("clears the timer even when the reader rejects (finally, not catch)", async () => {
    await expect(readTextWithTimeout(async () => Promise.reject(new Error("boom")), 500)).rejects.toThrow("boom")
    expect(vi.getTimerCount()).toBe(0)
  })

  it("falls back to '' when the reader never settles before the timeout", async () => {
    const promise = readTextWithTimeout(() => new Promise<string>(() => {}), 500)
    await vi.advanceTimersByTimeAsync(500)
    expect(await promise).toBe("")
    expect(vi.getTimerCount()).toBe(0)
  })
})
