/**
 * The React-free core of the Resolve-conflicts action: the finished-meanwhile
 * toast, the stale-continuation guard, and the park slot for an inactive row.
 * Git IO is injected; `conflict-prompt.test.ts` covers detection and wording.
 */

import { describe, expect, test } from "vitest"
import {
  requestResolveConflicts,
  resolveConflictsAction,
  takeResolveConflicts,
} from "../../src/tui-react/workspace/use-resolve-conflicts"

function deps(over: Partial<Parameters<typeof resolveConflictsAction>[0]> = {}) {
  const sent: string[] = []
  const errors: string[] = []
  const base = {
    worktree: "/wt/a",
    sendToEngineFn: { current: (text: string) => void sent.push(text) },
    selectedWorktreeRef: { current: "/wt/a" },
    notifyError: (message: string) => void errors.push(message),
    t: (key: string) => key,
    getBranch: () => "feat/x",
    readOperation: () => "merge" as const,
    readConflicts: async () => ["a.txt"],
    ...over,
  }
  return { base, sent, errors }
}

describe("resolveConflictsAction", () => {
  test("sends a prompt naming the conflicted files into the live session", async () => {
    const { base, sent, errors } = deps()
    await resolveConflictsAction(base)("t1")
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain("- a.txt")
    expect(errors).toEqual([])
  })

  test("toasts instead of sending when the operation finished since the menu opened", async () => {
    const { base, sent, errors } = deps({ readOperation: () => null })
    await resolveConflictsAction(base)("t1")
    expect(sent).toEqual([])
    expect(errors).toEqual(["files.toast.noPausedOperation"])
  })

  test("drops the prompt when the user switched tasks during the git read", async () => {
    const selected = { current: "/wt/a" }
    const { base, sent } = deps({
      selectedWorktreeRef: selected,
      readConflicts: async () => {
        selected.current = "/wt/b"
        return ["a.txt"]
      },
    })
    await resolveConflictsAction(base)("t1")
    expect(sent).toEqual([])
  })
})

describe("the park slot", () => {
  test("hands a parked request only to the task it was aimed at, once", () => {
    requestResolveConflicts("t2")
    expect(takeResolveConflicts("t1")).toBeNull()
    expect(takeResolveConflicts("t2")).toBe("t2")
    expect(takeResolveConflicts("t2")).toBeNull()
  })
})
