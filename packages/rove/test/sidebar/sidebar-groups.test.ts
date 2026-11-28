import { describe, expect, it } from "vitest"
import {
  type SidebarRow,
  reconcileSidebarRows,
  repoBasename,
  resolveCursorTarget,
  sameSidebarRowTask,
  sidebarProjectKey,
  sidebarProjectLabel,
} from "../../src/sidebar/groups.ts"
import type { Task } from "../../src/types/task.ts"
import { toTaskId } from "../../src/types/task.ts"

it("uses one sidebar identity and basename for Windows repo spellings", () => {
  expect(sidebarProjectKey("c:\\Projects\\demo\\")).toBe(sidebarProjectKey("C:/Projects/demo"))
  expect(repoBasename("C:\\Projects\\demo\\")).toBe("demo")
  expect(sidebarProjectKey("ssh://host/srv/demo")).toBe("ssh://host/srv/demo")
  expect(repoBasename("/srv/demo\\part")).toBe("demo\\part")
  expect(sidebarProjectLabel("/srv/demo\\part", ["/other/demo\\part"])).toBe("srv/demo\\part")
})

function task(overrides: Omit<Partial<Task>, "id"> & { id: string; title: string }): Task {
  return {
    repo: "/repo/rove",
    branch: overrides.title,
    worktreePath: `/repo/rove/${overrides.id}`,
    kind: "task",
    status: "backlog",
    pinned: false,
    vendor: "claude",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
    id: toTaskId(overrides.id),
  } as Task
}

function rows(tasks: readonly Task[]): SidebarRow[] {
  return tasks.map((t, flatIndex) => ({ kind: "task", task: t, flatIndex }))
}

/**
 * Identity contract for the sidebar's row reconciler (docs/DESIGN.md §5.5).
 *
 * Why these matter: the Tasks pane lives for days in every tmux session,
 * list rendering keys rows by OBJECT IDENTITY, and @opentui/core 0.2.4
 * retains ~300B of native memory per renderable create/destroy cycle.
 * Every daemon `task.snapshot` push deserializes ALL-new Task objects —
 * including the no-visual-change push from `setActiveTask`'s recency
 * touch on EVERY task switch — so without reconciliation each push
 * destroys and recreates every row's renderables (the same leak class
 * as the Ops-pane filetree, `test/tui/filetree-rows.test.ts`). The fix
 * is invisible to value-equality assertions: these tests pin identity
 * reuse with toBe — break it and the UI renders identically while the
 * leak silently returns.
 */
describe("reconcileSidebarRows", () => {
  it("a content-identical snapshot push returns the PREVIOUS array itself (no downstream notify)", () => {
    // Simulates the daemon echo: all-new Task objects, identical content.
    const prev = rows([task({ id: "a", title: "a" }), task({ id: "b", title: "b" })])
    const next = rows([task({ id: "a", title: "a" }), task({ id: "b", title: "b" })])
    expect(reconcileSidebarRows(prev, next)).toBe(prev)
  })

  it("an updatedAt-only bump (setActiveTask recency touch) does not re-key any row", () => {
    const prev = rows([task({ id: "a", title: "a" }), task({ id: "b", title: "b" })])
    const next = rows([
      task({ id: "a", title: "a", updatedAt: "2026-06-10T12:00:00.000Z" }),
      task({ id: "b", title: "b" }),
    ])
    expect(reconcileSidebarRows(prev, next)).toBe(prev)
  })

  it("a changed task gets a fresh row; unchanged siblings keep their previous object identity", () => {
    const prev = rows([task({ id: "a", title: "a" }), task({ id: "b", title: "b" })])
    const next = rows([task({ id: "a", title: "renamed" }), task({ id: "b", title: "b" })])
    const out = reconcileSidebarRows(prev, next)
    expect(out).not.toBe(prev)
    expect(out[0]).toBe(next[0]) // title changed → fresh object (renderer captures task non-reactively)
    expect(out[1]).toBe(prev[1]) // untouched → reused, <For> keeps its renderables
  })

  it("a reorder breaks reuse via flatIndex (renderer captures flatIndex non-reactively)", () => {
    const prev = rows([task({ id: "a", title: "a" }), task({ id: "b", title: "b" })])
    const next = rows([task({ id: "b", title: "b" }), task({ id: "a", title: "a" })])
    const out = reconcileSidebarRows(prev, next)
    expect(out).not.toBe(prev)
    expect(out[0]).toBe(next[0])
    expect(out[1]).toBe(next[1])
  })

  it("appending a task reuses every existing row", () => {
    const prev = rows([task({ id: "a", title: "a" })])
    const next = rows([task({ id: "a", title: "a" }), task({ id: "b", title: "b" })])
    const out = reconcileSidebarRows(prev, next)
    expect(out).not.toBe(prev)
    expect(out[0]).toBe(prev[0])
    expect(out[1]).toBe(next[1])
  })

  it("empty prev passes next through untouched", () => {
    const next = rows([task({ id: "a", title: "a" })])
    expect(reconcileSidebarRows([], next)).toBe(next)
  })
})

describe("sameSidebarRowTask", () => {
  it("ignores updatedAt/createdAt but notices every rendered field", () => {
    const base = task({ id: "a", title: "a" })
    expect(sameSidebarRowTask(base, task({ id: "a", title: "a", updatedAt: "2027-01-01T00:00:00.000Z" }))).toBe(true)
    expect(sameSidebarRowTask(base, task({ id: "a", title: "a", status: "in_progress" }))).toBe(false)
    expect(sameSidebarRowTask(base, task({ id: "a", title: "a", branch: "feat/x" }))).toBe(false)
    expect(sameSidebarRowTask(base, task({ id: "a", title: "a", pinned: true }))).toBe(false)
    expect(sameSidebarRowTask(base, task({ id: "a", title: "a", vendor: "codex" }))).toBe(false)
  })
})

describe("resolveCursorTarget", () => {
  const ids = ["a", "b", "c"]

  it("follows the selected row", () => {
    expect(resolveCursorTarget("a", ids, 2)).toBe(0)
    expect(resolveCursorTarget("c", ids, 0)).toBe(2)
  })

  it("leaves the cursor put when already on the selected row (no-op)", () => {
    expect(resolveCursorTarget("b", ids, 1)).toBe(1)
  })

  it("selected row absent but cursor in range → leave it put (j/k freedom)", () => {
    expect(resolveCursorTarget("gone", ids, 1)).toBe(1)
  })

  it("selected row vanished and cursor now dangles past a shrunk list → clamp to last", () => {
    expect(resolveCursorTarget("gone", ["a", "b"], 5)).toBe(1)
    expect(resolveCursorTarget("gone", ["a", "b"], -1)).toBe(1)
  })

  it("empty list → -1, except a stray cursor with null selection resolves to 0", () => {
    expect(resolveCursorTarget("a", [], 0)).toBe(-1)
    expect(resolveCursorTarget(null, [], 3)).toBe(0) // cursor>=len(0) path snaps to max(0,-1)=0... see null-empty
    expect(resolveCursorTarget(null, [], -1)).toBe(-1)
  })

  it("null selection: snap an unset cursor to the first row, else keep it", () => {
    expect(resolveCursorTarget(null, ids, -1)).toBe(0)
    expect(resolveCursorTarget(null, ids, 2)).toBe(2)
    expect(resolveCursorTarget(null, ids, 9)).toBe(2) // out of range → clamp to last
  })
})

describe("project identity and labels across machines", () => {
  it("keys the same path on two machines as two projects", () => {
    // Without the machine in the key, `~/i/rove` on the laptop and on the
    // build box merged into ONE sidebar row carrying both machines' tasks.
    expect(sidebarProjectKey("/i/rove", "narwhal")).not.toBe(sidebarProjectKey("/i/rove"))
  })

  it("leaves the local key byte-identical to the pre-machines one", () => {
    expect(sidebarProjectKey("/i/rove", "local")).toBe(sidebarProjectKey("/i/rove"))
  })

  it("disambiguates a cross-machine basename collision by host", () => {
    const repos = [
      { repo: "/i/rove", hostLabel: undefined },
      { repo: "/i/rove", hostLabel: "narwhal" },
    ]
    expect(sidebarProjectLabel("/i/rove", repos)).toBe("rove")
    expect(sidebarProjectLabel("/i/rove", repos, "narwhal")).toBe("narwhal:rove")
  })

  it("still uses the path tail for a collision on ONE machine", () => {
    expect(sidebarProjectLabel("/work/api", ["/work/api", "/oss/api"])).toBe("work/api")
  })

  it("uses the path tail when the collision is on the same REMOTE machine", () => {
    // Both checkouts answered `narwhal:rove` when the machine test came
    // first — two headers reading as one project, on the very machine whose
    // name was supposed to be doing the telling-apart.
    const repos = [
      { repo: "/Users/n/gihub/rove", hostLabel: "narwhal" },
      { repo: "/Users/n/i/rove", hostLabel: "narwhal" },
    ]
    expect(sidebarProjectLabel("/Users/n/gihub/rove", repos, "narwhal")).toBe("gihub/rove")
    expect(sidebarProjectLabel("/Users/n/i/rove", repos, "narwhal")).toBe("i/rove")
  })

  it("puts the host in front of a tail that also repeats across machines", () => {
    const repos = [
      { repo: "/a/i/rove", hostLabel: "narwhal" },
      { repo: "/b/i/rove", hostLabel: "narwhal" },
      { repo: "/c/i/rove", hostLabel: "vps" },
    ]
    expect(sidebarProjectLabel("/a/i/rove", repos, "narwhal")).toBe("narwhal:i/rove")
  })
})
