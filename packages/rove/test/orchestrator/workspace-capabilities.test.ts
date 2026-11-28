import { workspaceBackendId, workspaceCapabilities } from "@sma1lboy/rove-core/orchestrator/workspace/index.ts"
import { describe, expect, it } from "vitest"

describe("workspace capabilities", () => {
  it("derives the backend from kind when a row records none", () => {
    expect(workspaceBackendId({ kind: "task" })).toBe("git-worktree")
    expect(workspaceBackendId({})).toBe("git-worktree")
    expect(workspaceBackendId({ kind: "dir" })).toBe("borrowed")
  })

  it("lets an explicit backend win over kind", () => {
    const caps = workspaceCapabilities({ kind: "task", workspace: { backend: "cow-clone" } })
    expect(caps).toMatchObject({ fork: "with-uncommitted", cheapClone: true, ownsBranch: true, ownsDirectory: true })
  })

  it("never lets Rove land or remove a borrowed dir directory", () => {
    expect(workspaceCapabilities({ kind: "dir" })).toMatchObject({
      ownsBranch: false,
      ownsDirectory: false,
      checkpoint: false,
    })
  })
})
