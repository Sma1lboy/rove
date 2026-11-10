/**
 * Machines in the sidebar tree: no machine sections. Projects from every
 * machine share one list, a repo checked out on several machines is ONE
 * project (merged by `repoId`), and a task living on another machine wears a
 * cloud mark instead of sitting under a machine header.
 *
 * The load-bearing test is the FIRST one: an install with no machines must get
 * back the very array it handed in. Every screenshot, golden and muscle memory
 * recorded before machines existed depends on that being literally true rather
 * than merely equal.
 */

import { describe, expect, it } from "vitest"
import { sidebarProjectKey } from "../../src/tui/panes/sidebar/groups.ts"
import {
  type MachineLayerEntry,
  applyMachineLayer,
  remoteRowCaption,
} from "../../src/tui/panes/sidebar/machine-layer.ts"
import { buildSidebarGroups } from "../../src/tui/panes/sidebar/project-groups.ts"
import {
  type TreeRow,
  buildTreeRows,
  filterTreeRows,
  mainTaskIdOfProject,
  projectKeysOf,
} from "../../src/tui/panes/sidebar/tree-core.ts"
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
const ROVE_ID = "github.com/sma1lboy/rove"
const MAC = { machineId: "mac", hostLabel: "mac-mini" }
const MAC_ONLINE: MachineLayerEntry = { alias: "mac", hostLabel: "mac-mini", state: "online", version: "0.9.259" }

/** rove checked out here AND on the mac, a task on each. */
function mergedTasks(macOrigin: Task["origin"] = MAC): Task[] {
  return [
    task({ id: "local-main", repo: "/i/rove", repoId: ROVE_ID }),
    task({ id: "local-task", kind: "task", repo: "/i/rove", branch: "feat/here", repoId: ROVE_ID }),
    task({ id: "mac-main", repo: "/Users/n/rove", repoId: ROVE_ID, origin: macOrigin }),
    task({
      id: "mac-task",
      kind: "task",
      repo: "/Users/n/rove",
      branch: "feat/there",
      repoId: ROVE_ID,
      origin: macOrigin,
    }),
  ]
}

const worktrees = (rows: readonly TreeRow[]) =>
  rows.flatMap((row) => (row.kind === "worktree" ? [{ id: String(row.task.id), remote: row.remote }] : []))

describe("applyMachineLayer", () => {
  it("returns the SAME array when no machine is registered", () => {
    const rows = buildTreeRows({
      tasks: [task({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", repo: "/i/rove" })],
      tabsByTask: NO_TABS,
    })
    expect(applyMachineLayer(rows, [])).toBe(rows)
  })

  it("merges one repo across local + mac into ONE header, both machines' tasks under it", () => {
    const rows = applyMachineLayer(buildTreeRows({ tasks: mergedTasks(), tabsByTask: NO_TABS }), [MAC_ONLINE])
    const projects = rows.filter((row) => row.kind === "project")
    // One header, named by the repo, keyed by THIS machine's checkout.
    expect(projects).toEqual([
      expect.objectContaining({ label: "rove", id: sidebarProjectKey("/i/rove"), machineId: "local", depth: 0 }),
    ])
    // No machine header rows, no extra indent; only the mac rows carry the mark.
    expect(rows.every((row) => row.kind === "project" || row.depth === 1)).toBe(true)
    expect(worktrees(rows)).toEqual([
      { id: "local-main", remote: undefined },
      { id: "mac-main", remote: { host: "mac-mini", state: "online", version: "0.9.259" } },
      { id: "local-task", remote: undefined },
      { id: "mac-task", remote: { host: "mac-mini", state: "online", version: "0.9.259" } },
    ])
  })

  it("keeps an offline machine's rows, marked offline, instead of dropping them", () => {
    const tasks = mergedTasks({ ...MAC, stale: true })
    const rows = applyMachineLayer(buildTreeRows({ tasks, tabsByTask: NO_TABS }), [
      { alias: "mac", hostLabel: "mac-mini", state: "offline" },
    ])
    // A laptop with a closed lid has not stopped having these tasks.
    expect(worktrees(rows).filter((row) => row.remote)).toEqual([
      { id: "mac-main", remote: { host: "mac-mini", state: "offline" } },
      { id: "mac-task", remote: { host: "mac-mini", state: "offline" } },
    ])
  })

  it("a repo checked out ONLY on another machine is still a normal header", () => {
    const tasks = [
      task({ id: "here", repo: "/i/api" }),
      task({ id: "there", repo: "/Users/n/rove", repoId: ROVE_ID, origin: MAC }),
    ]
    const rows = applyMachineLayer(buildTreeRows({ tasks, tabsByTask: NO_TABS }), [MAC_ONLINE])
    expect(rows.filter((row) => row.kind === "project").map((row) => [row.label, row.depth])).toEqual([
      ["api", 0],
      ["rove", 0],
    ])
  })

  it("drops rows of a machine that is no longer registered, and the header they leave empty", () => {
    const tasks = [
      task({
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
        repo: "/i/rove",
        origin: { machineId: "gone", hostLabel: "gone" },
      }),
    ]
    const rows: readonly TreeRow[] = applyMachineLayer(buildTreeRows({ tasks, tabsByTask: NO_TABS }), [MAC_ONLINE])
    // An unmarked remote row would read as a local one.
    expect(rows).toHaveLength(0)
  })

  it("search keeps a matching mac task under the merged header", () => {
    const rows = buildTreeRows({ tasks: mergedTasks(), tabsByTask: NO_TABS })
    const hit = applyMachineLayer(filterTreeRows(rows, "feat/the"), [MAC_ONLINE])
    expect(hit.map((row) => row.kind)).toEqual(["project", "worktree"])
    expect(worktrees(hit)).toEqual([{ id: "mac-task", remote: expect.objectContaining({ host: "mac-mini" }) }])
  })
})

describe("merged projects", () => {
  it("labels DIFFERENT repos sharing a basename by owner/name, never host:", () => {
    const tasks = [
      task({ id: "a", repo: "/i/rove", repoId: "github.com/sma1lboy/rove" }),
      task({ id: "b", repo: "/Users/n/rove", repoId: "github.com/someone/rove", origin: MAC }),
    ]
    const groups = buildSidebarGroups({ tasks, tabsByTask: NO_TABS })
    expect(groups.map((group) => group.label)).toEqual(["sma1lboy/rove", "someone/rove"])
  })

  it("labels the same repo on two machines by its bare basename", () => {
    const groups = buildSidebarGroups({ tasks: mergedTasks(), tabsByTask: NO_TABS })
    expect(groups.map((group) => group.label)).toEqual(["rove"])
  })

  it("project actions pick the local checkout when the repo exists here", () => {
    // The mac's checkout listed FIRST must not become the header's home.
    const tasks = [...mergedTasks().slice(2), ...mergedTasks().slice(0, 2)]
    const [group] = buildSidebarGroups({ tasks, tabsByTask: NO_TABS })
    expect(group).toMatchObject({ repo: "/i/rove", machineId: "local", key: sidebarProjectKey("/i/rove") })
    // Forget / reorder act on THIS machine's main, never the mac's.
    expect(mainTaskIdOfProject(tasks, group?.key ?? "")).toBe("local-main")
    expect(projectKeysOf(tasks)).toEqual([sidebarProjectKey("/i/rove")])
  })

  it("project actions pick the first machine's checkout when the repo is not here", () => {
    const tasks = [
      task({ id: "mac-main", repo: "/Users/n/rove", repoId: ROVE_ID, origin: MAC }),
      task({ id: "vps-main", repo: "/srv/rove", repoId: ROVE_ID, origin: { machineId: "vps", hostLabel: "vps" } }),
    ]
    const [group] = buildSidebarGroups({ tasks, tabsByTask: NO_TABS })
    expect(group).toMatchObject({ repo: "/Users/n/rove", machineId: "mac" })
    expect(group?.tasks.map((t) => String(t.id))).toEqual(["mac-main", "vps-main"])
  })

  it("keeps per-machine projects apart when no repoId is known", () => {
    const tasks = [task({ id: "a", repo: "/i/rove" }), task({ id: "b", repo: "/i/rove", origin: MAC })]
    const groups = buildSidebarGroups({ tasks, tabsByTask: NO_TABS })
    expect(groups.map((group) => [group.label, group.machineId])).toEqual([
      ["rove", "local"],
      ["rove", "mac"],
    ])
  })
})

describe("remoteRowCaption", () => {
  const t = (key: string, params?: Record<string, string | number>) =>
    key === "tasks.machine.runsOn" ? `on ${params?.host}` : (key.split(".").at(-1) ?? key)

  it("names the version when online and the state otherwise", () => {
    expect(remoteRowCaption({ host: "mac-mini", state: "online", version: "0.9.185" }, t)).toBe(
      "on mac-mini · v0.9.185",
    )
    expect(remoteRowCaption({ host: "mac-mini", state: "offline" }, t)).toBe("on mac-mini · offline")
    expect(remoteRowCaption({ host: "old", state: "mismatch", version: "0.9.100" }, t)).toBe("on old · mismatch")
  })
})
