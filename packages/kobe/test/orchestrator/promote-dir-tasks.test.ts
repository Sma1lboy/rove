/**
 * Which `dir` rows deserve to become a project's `main` row.
 *
 * `rove .` has routed a repo root to `ensureMainTask` since 2026-08-31, so
 * nothing new lands mis-shaped. The rows created BEFORE that have no owner:
 * they sit on a git toplevel rendering as a bare path, outside every rule
 * written for `main` — the project ordering, the pin, the fold on a closed
 * last tab. This is the sweep that finds them.
 *
 * The exclusions are the whole reason this is a function and not a filter
 * inline: each one is a row that LOOKS promotable and must not be.
 */

import { describe, expect, it } from "vitest"
import { promotableDirTasks } from "../../src/orchestrator/promote-dir-tasks.ts"
import type { Task } from "../../src/types/task.ts"

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    repo: `/repos/${id}`,
    branch: "",
    worktreePath: `/repos/${id}`,
    kind: "dir",
    status: "backlog",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  } as Task
}

const anyRepo = () => true
const ids = (tasks: readonly Task[]): string[] => tasks.map((t) => t.id)

describe("promotableDirTasks", () => {
  it("promotes a dir row pinned to a repo root", () => {
    const t = task("site", { repo: "/i/site", worktreePath: "/i/site" })
    expect(ids(promotableDirTasks({ tasks: [t], isRepoRoot: anyRepo }))).toEqual(["site"])
  })

  it("leaves a directory that is not a repo alone", () => {
    // `boccha` in the field: a plain folder opened with `rove .`. It is a dir
    // task because it IS one, not because a rule missed it.
    const t = task("notes", { repo: "/i/notes" })
    expect(promotableDirTasks({ tasks: [t], isRepoRoot: () => false })).toEqual([])
  })

  it("leaves a scratch shell alone even when it started inside a repo", () => {
    // Issue #33: a scratch shell's cwd is unsettled by definition. Promoting
    // it would turn a throwaway terminal into a permanent project row.
    const t = task("tmp", { repo: "/i/site", scratch: true })
    expect(promotableDirTasks({ tasks: [t], isRepoRoot: anyRepo })).toEqual([])
  })

  it("leaves a root that already has a main row", () => {
    // Promoting here mints a SECOND row for one checkout — the duplicate that
    // `ensureMainTask` exists to prevent.
    const dir = task("d", { repo: "/i/site" })
    const main = task("m", { kind: "main", repo: "/i/site" })
    expect(promotableDirTasks({ tasks: [dir, main], isRepoRoot: anyRepo })).toEqual([])
  })

  it("promotes only the first of two dir rows on the SAME root", () => {
    // Both would resolve to one main row; the second would be absorbed into a
    // row that no longer needs it, so it stays a dir row and the user decides.
    const a = task("a", { repo: "/i/site" })
    const b = task("b", { repo: "/i/site" })
    expect(ids(promotableDirTasks({ tasks: [a, b], isRepoRoot: anyRepo }))).toEqual(["a"])
  })

  it("ignores real work — a task row is never promoted", () => {
    const t = task("w", { kind: "task", repo: "/i/site", branch: "feat/x" })
    expect(promotableDirTasks({ tasks: [t], isRepoRoot: anyRepo })).toEqual([])
  })
})
