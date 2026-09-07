import { describe, expect, it } from "vitest"
import { userFacingErrorMessage } from "../../src/lib/error-message.ts"

/**
 * The worktree/task layers stamp their throws with the function that raised
 * them. That prefix belongs in `client.log`, never in a toast — see the
 * helper's own doc. These cases are the real strings from
 * `orchestrator/worktree/manager.ts`, `task-editor.ts`, and git itself.
 */
describe("userFacingErrorMessage", () => {
  it("drops a parenthesised throw-site prefix", () => {
    expect(userFacingErrorMessage(new Error("create(): /p exists but is not a registered git worktree"))).toBe(
      "/p exists but is not a registered git worktree",
    )
    expect(userFacingErrorMessage(new Error("currentBranch(): /p is in detached-HEAD state"))).toBe(
      "/p is in detached-HEAD state",
    )
  })

  it("drops a camelCase throw-site prefix that has no parens", () => {
    expect(userFacingErrorMessage(new Error("setBranch: branch is required"))).toBe("branch is required")
    expect(userFacingErrorMessage(new Error("adoptWorktree: /p is already adopted as a task"))).toBe(
      "/p is already adopted as a task",
    )
  })

  it("keeps a lowercase prose prefix — dropping git's `fatal:` would change the meaning", () => {
    expect(userFacingErrorMessage(new Error("fatal: not a git repository"))).toBe("fatal: not a git repository")
    expect(userFacingErrorMessage(new Error("error: pathspec did not match"))).toBe("error: pathspec did not match")
    expect(userFacingErrorMessage(new Error("ENOENT: no such file or directory"))).toBe(
      "ENOENT: no such file or directory",
    )
  })

  it("strips only the leading prefix, so the rest of the sentence survives", () => {
    expect(
      userFacingErrorMessage(new Error("create(): git reported success but /p is not a worktree: fatal: bad")),
    ).toBe("git reported success but /p is not a worktree: fatal: bad")
  })

  it("passes non-Error throws through the same way errorMessage does", () => {
    expect(userFacingErrorMessage("remove(): /p is not a git worktree")).toBe("/p is not a git worktree")
    expect(userFacingErrorMessage(undefined)).toBe("undefined")
  })
})
