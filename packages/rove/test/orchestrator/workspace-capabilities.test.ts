import { describe, expect, it } from "vitest"
import { workspaceBackendId, workspaceCapabilities } from "../../src/orchestrator/workspace/index.ts"

describe("workspace capabilities", () => {
  it("derives the backend from kind when a row records none", () => {
    expect(workspaceBackendId({ kind: "task" })).toBe("git-worktree")
    expect(workspaceBackendId({})).toBe("git-worktree")
    expect(workspaceBackendId({ kind: "main" })).toBe("borrowed")
    expect(workspaceBackendId({ kind: "dir" })).toBe("borrowed")
  })

  it("lets an explicit backend win over kind", () => {
    const caps = workspaceCapabilities({ kind: "task", workspace: { backend: "cow-clone" } })
    expect(caps).toMatchObject({ fork: "with-uncommitted", cheapClone: true, ownsBranch: true, ownsDirectory: true })
  })

  it("never lets Rove land or remove a borrowed directory", () => {
    for (const kind of ["main", "dir"] as const) {
      expect(workspaceCapabilities({ kind })).toMatchObject({
        ownsBranch: false,
        ownsDirectory: false,
        checkpoint: false,
      })
    }
  })
})
