/**
 * The machine layer of the sidebar tree.
 *
 * The load-bearing test is the FIRST one: an install with no machines must get
 * back the very array it handed in. Every screenshot, golden and muscle memory
 * recorded before machines existed depends on that being literally true rather
 * than merely equal.
 */

import { describe, expect, it } from "vitest"
import { applyMachineLayer, machineRowLabel } from "../../src/tui/panes/sidebar/machine-layer.ts"
import { type TreeRow, buildTreeRows } from "../../src/tui/panes/sidebar/tree-core.ts"
import { type Task, toTaskId } from "../../src/types/task.ts"

function task(over: Omit<Partial<Task>, "id"> & { id: string; repo: string }): Task {
  return {
    title: "t",
    branch: "",
    worktreePath: over.repo,
    kind: "main",
    status: "active",
    pinned: false,
    createdAt: "2026-09-09T00:00:00Z",
    updatedAt: "2026-09-09T00:00:00Z",
    ...over,
    id: toTaskId(over.id),
  } as Task
}

const NO_TABS = new Map<string, never[]>()

describe("applyMachineLayer", () => {
  it("returns the SAME array when no machine is registered", () => {
    const rows = buildTreeRows({
      tasks: [task({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", repo: "/i/kobe" })],
      tabsByTask: NO_TABS,
    })
    expect(applyMachineLayer(rows, [])).toBe(rows)
  })

  it("puts a remote machine's projects under a header, indented by one", () => {
    const tasks = [
      task({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", repo: "/i/kobe" }),
      task({
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
        repo: "/i/kobe",
        origin: { machineId: "narwhal", hostLabel: "mac-mini" },
      }),
    ]
    const rows = applyMachineLayer(buildTreeRows({ tasks, tabsByTask: NO_TABS }), [
      { alias: "narwhal", hostLabel: "mac-mini", state: "online", version: "0.9.185" },
    ])
    // Local first, at the depth it has always had; then the machine header.
    expect(rows[0]).toMatchObject({ kind: "project", machineId: "local", depth: 0 })
    const headerAt = rows.findIndex((row) => row.kind === "machine")
    expect(headerAt).toBeGreaterThan(0)
    const under = rows.slice(headerAt + 1)
    expect(under[0]).toMatchObject({ kind: "project", machineId: "narwhal", depth: 1 })
    expect(under[1]).toMatchObject({ kind: "worktree", depth: 2 })
  })

  it("keeps an offline machine's rows instead of dropping them", () => {
    const tasks = [
      task({
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
        repo: "/i/kobe",
        origin: { machineId: "narwhal", hostLabel: "mac-mini", stale: true },
      }),
    ]
    const rows = applyMachineLayer(buildTreeRows({ tasks, tabsByTask: NO_TABS }), [
      { alias: "narwhal", hostLabel: "mac-mini", state: "offline" },
    ])
    // A laptop with a closed lid has not stopped having these tasks.
    expect(rows.filter((row) => row.kind === "worktree")).toHaveLength(1)
    expect(rows.find((row) => row.kind === "machine")).toMatchObject({ state: "offline" })
  })

  it("drops rows of a machine that is no longer registered", () => {
    const tasks = [
      task({
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
        repo: "/i/kobe",
        origin: { machineId: "gone", hostLabel: "gone" },
      }),
    ]
    const rows: readonly TreeRow[] = applyMachineLayer(buildTreeRows({ tasks, tabsByTask: NO_TABS }), [
      { alias: "narwhal", hostLabel: "mac-mini", state: "online" },
    ])
    // A headerless remote project would read as a local one.
    expect(rows.filter((row) => row.kind === "project")).toHaveLength(0)
  })
})

describe("machineRowLabel", () => {
  const t = (key: string) => key.split(".").at(-1) ?? key

  it("names the version when online and the state otherwise", () => {
    expect(machineRowLabel({ alias: "n", hostLabel: "mac-mini", state: "online", version: "0.9.185" }, t)).toBe(
      "mac-mini · v0.9.185",
    )
    expect(machineRowLabel({ alias: "n", hostLabel: "mac-mini", state: "offline" }, t)).toBe("mac-mini · offline")
  })

  it("marks a protocol mismatch with the version that caused it", () => {
    expect(machineRowLabel({ alias: "n", hostLabel: "old", state: "mismatch", version: "0.9.100" }, t)).toBe(
      "old · ⚠ v0.9.100 (mismatch)",
    )
  })
})
