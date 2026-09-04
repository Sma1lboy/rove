/**
 * A daemon refusal reaches the caller with its OWN code.
 *
 * The failure shape: `rove api delete` on a task whose worktree has
 * uncommitted files came back as
 * `{"message":"DIRTY_WORKTREE: task … has uncommitted or untracked changes","code":"RPC_ERROR"}`.
 * The code was right there in the message and the envelope threw it away,
 * because `toApiError` mapped exactly two patterns by hand and this refusal —
 * the one an unattended cleanup loop hits most — was not one of them. An agent
 * could only tell "this worktree has unlanded work" from "the daemon fell
 * over" by parsing prose.
 *
 * So the boundary parses the prefix ONCE, for every daemon error, and the two
 * hand-mapped patterns keep their recovery steps. Both halves are asserted
 * here: a lift that broke `TASK_NOT_FOUND`'s `nextCommandArgs` would trade one
 * silent failure for another.
 */

import { describe, expect, it } from "vitest"
import { toApiError } from "../../src/cli/api-cmd.ts"

describe("daemon error codes at the CLI boundary", () => {
  it("lifts a CODE: prefix into `code` and drops it from the message", () => {
    const err = toApiError(new Error("DIRTY_WORKTREE: task t1 worktree has uncommitted or untracked changes"))
    expect(err.code).toBe("DIRTY_WORKTREE")
    expect(err.message).toBe("task t1 worktree has uncommitted or untracked changes")
  })

  it("covers every sentinel the orchestrator writes, not an allowlist of two", () => {
    // Sampled across orchestrator/errors.ts — the point of parsing the shape
    // rather than the names is that a code added there needs no CLI change.
    for (const code of [
      "LAND_CONFLICT",
      "MISSING_REF",
      "MAIN_CHECKOUT_DIRTY",
      "GIT_COMMAND_FAILED",
      "TASK_DELETING",
      "EMPTY_BRANCH",
      "ISSUE_NOT_FOUND",
    ]) {
      expect(toApiError(new Error(`${code}: something went wrong`)).code).toBe(code)
    }
  })

  it("keeps TASK_NOT_FOUND's recovery — the lift must not shadow the hand-mapped patterns", () => {
    // The daemon writes this one WITHOUT a code prefix, so it has to stay a
    // special case. Its `nextCommandArgs` is the most-used recovery on the
    // surface; losing it here would be a regression the code lift caused.
    const err = toApiError(new Error("task not found: t9"))
    expect(err.code).toBe("TASK_NOT_FOUND")
    expect(err.data?.nextCommandArgs).toEqual(["api", "list"])
  })

  it("keeps the version-skew rejection ahead of the generic lift", () => {
    const err = toApiError(new Error("unknown daemon request: task.archive"))
    expect(err.code).toBe("DAEMON_VERSION_SKEW")
    expect(err.data?.nextCommandArgs).toEqual(["daemon", "restart"])
  })

  it("leaves an uncoded failure as RPC_ERROR", () => {
    // RPC_ERROR has to keep meaning something: "the daemon failed and did not
    // name a reason". A prefix rule loose enough to match prose would make it
    // meaningless in the other direction — so `Error:` (not all-caps) and a
    // two-letter head do not qualify.
    for (const message of [
      "disk is full",
      "Error: connection reset",
      "AB: too short to be a code",
      "no issue #999",
      "lowercase_code: not a code",
    ]) {
      expect(toApiError(new Error(message))).toMatchObject({ code: "RPC_ERROR", message })
    }
  })

  it("also lifts a node errno, which is deliberate", () => {
    // The rule is SHAPE, not a roster of Rove's own names — that is what makes
    // a new orchestrator sentinel need no CLI change. A `ENOENT` bubbling up
    // from the daemon lands the same way, and a caller is better off with it
    // than with RPC_ERROR.
    expect(toApiError(new Error("ENOENT: no such file or directory, open '/x'")).code).toBe("ENOENT")
  })
})
