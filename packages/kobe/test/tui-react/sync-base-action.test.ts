/**
 * The React-free core of "Sync with base" (`syncBaseAction`): which of the
 * daemon's outcomes becomes a plain toast, which becomes the attention tone,
 * and which is a real error. The daemon is injected, so these pin the
 * classification — the git itself is `orchestrator/sync-base.ts`.
 */

import { describe, expect, test } from "vitest"
import { SYNC_CONFLICT, SYNC_DIRTY, parseConflictedPaths } from "../../src/orchestrator/sync-base"
import { syncBaseAction } from "../../src/tui-react/workspace/sync-base-action"

function deps(syncBase: () => Promise<{ baseRef: string; alreadyCurrent: boolean }>) {
  const info: string[] = []
  const attention: string[] = []
  const errors: string[] = []
  return {
    deps: {
      orchestrator: { syncBase },
      notifyInfo: (m: string) => void info.push(m),
      notifyNeedsInput: (m: string) => void attention.push(m),
      notifyError: (m: string) => void errors.push(m),
      t: (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    },
    info,
    attention,
    errors,
  }
}

describe("syncBaseAction", () => {
  test("reports the merge, naming the base it merged", async () => {
    const h = deps(async () => ({ baseRef: "origin/main", alreadyCurrent: false }))
    expect(await syncBaseAction(h.deps, "t1")).toBe(true)
    expect(h.info).toEqual(['tasks.sync.done {"base":"origin/main"}'])
    expect(h.attention).toEqual([])
    expect(h.errors).toEqual([])
  })

  test("says so — rather than nothing — when the worktree was already current", async () => {
    const h = deps(async () => ({ baseRef: "main", alreadyCurrent: true }))
    expect(await syncBaseAction(h.deps, "t1")).toBe(true)
    expect(h.info).toEqual(['tasks.sync.alreadyCurrent {"base":"main"}'])
  })

  test("a conflict is ATTENTION, not an error, and names the files", async () => {
    const h = deps(async () => {
      throw new Error(`${SYNC_CONFLICT}: src/a.ts, src/b.ts`)
    })
    expect(await syncBaseAction(h.deps, "t1")).toBe(false)
    expect(h.attention).toEqual(['tasks.sync.conflict {"files":"src/a.ts, src/b.ts"}'])
    expect(h.errors).toEqual([])
  })

  test("a dirty worktree is attention too — it is a precondition, not a failure", async () => {
    const h = deps(async () => {
      throw new Error(SYNC_DIRTY)
    })
    expect(await syncBaseAction(h.deps, "t1")).toBe(false)
    expect(h.attention).toEqual(["tasks.sync.dirty"])
    expect(h.errors).toEqual([])
  })

  test("anything else IS an error — a marker-less failure must not read as routine", async () => {
    const h = deps(async () => {
      throw new Error("git merge origin/main failed")
    })
    expect(await syncBaseAction(h.deps, "t1")).toBe(false)
    expect(h.attention).toEqual([])
    expect(h.errors).toEqual(['tasks.sync.failed {"error":"git merge origin/main failed"}'])
  })
})

describe("parseConflictedPaths", () => {
  test("one path per line, blanks dropped", () => {
    expect(parseConflictedPaths("src/a.ts\nsrc/b.ts\n\n")).toEqual(["src/a.ts", "src/b.ts"])
  })

  test("empty output is an empty list — the merge failed for some other reason", () => {
    // The caller depends on this: an empty list must NOT be reported as a
    // conflict, or every merge failure would claim conflicted files.
    expect(parseConflictedPaths("")).toEqual([])
    expect(parseConflictedPaths("\n \n")).toEqual([])
  })
})
