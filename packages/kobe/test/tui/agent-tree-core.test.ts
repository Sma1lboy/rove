import { describe, expect, test } from "vitest"
import {
  clipTopologyRaster,
  layoutAgentTopology,
  topologyEdgeRaster,
  topologyViewportOffset,
} from "../../src/tui/multiagent/topology-layout"
import { buildAgentTopology, shortGroupId, topologyRootId } from "../../src/tui/multiagent/tree-core"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repos/rove",
    branch: `feat/${id}`,
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "in_progress",
    archived: false,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...over,
  }
}

describe("agent topology projection", () => {
  test("uses dispatcher edges and keeps fan-out as a batch enclosure", () => {
    const owner = task("owner")
    const a = task("a", { dispatcher: { taskId: "owner", tabId: "tab-1" }, groupId: "01ROUNDALPHA" })
    const b = task("b", { dispatcher: { taskId: "owner", tabId: "tab-1" }, groupId: "01ROUNDALPHA" })
    const direct = task("direct", { dispatcher: { taskId: "owner", tabId: "tab-2" } })
    const nested = task("nested", { dispatcher: { taskId: "a", tabId: "tab-3" } })

    const topology = buildAgentTopology([owner, a, b, direct, nested])

    expect(topology.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual([
      "owner->a",
      "owner->b",
      "owner->direct",
      "a->nested",
    ])
    expect(topology.batches).toEqual([{ id: "batch:01ROUNDALPHA", groupId: "01ROUNDALPHA", nodeIds: ["a", "b"] }])
    expect(topology.nodes.map((node) => `${node.id}:${node.role}`)).toEqual([
      "owner:root",
      "a:coordinator",
      "b:agent",
      "direct:agent",
      "nested:agent",
    ])
    expect(topology.summary).toEqual({ agents: 5, roots: 1, coordinators: 1, batches: 1, anomalies: 0 })
  })

  test("surfaces missing parents and every member of a corrupt cycle", () => {
    const orphan = task("orphan", { dispatcher: { taskId: "gone", tabId: "tab-1" } })
    const a = task("a", { dispatcher: { taskId: "b", tabId: "tab-1" } })
    const b = task("b", { dispatcher: { taskId: "a", tabId: "tab-1" } })
    const self = task("self", { dispatcher: { taskId: "self", tabId: "tab-1" } })

    const topology = buildAgentTopology([orphan, a, b, self])

    expect(topology.nodes.find((node) => node.id === "orphan")?.anomaly).toBe("orphan")
    expect(topology.nodes.find((node) => node.id === "self")?.anomaly).toBe("cycle")
    expect(topology.nodes.find((node) => node.id === "a")?.anomaly).toBe("cycle")
    expect(topology.nodes.find((node) => node.id === "b")?.anomaly).toBe("cycle")
    expect(topology.summary.anomalies).toBe(4)
  })

  test("lays out and rasterizes a directed spawn graph", () => {
    const owner = task("owner")
    const child = task("child", { dispatcher: { taskId: "owner", tabId: "tab-1" } })
    const layout = layoutAgentTopology(buildAgentTopology([owner, child]), { direction: "TB", nodeWidth: 20 })
    const root = layout.nodes.find((node) => node.id === "owner")!
    const leaf = layout.nodes.find((node) => node.id === "child")!
    const raster = topologyEdgeRaster(layout)

    expect(root.y).toBeLessThan(leaf.y)
    expect(raster.join("\n")).toMatch(/[│▼]/)
    const offset = topologyViewportOffset(layout, "child", { width: 16, height: 8 })
    const clipped = clipTopologyRaster(raster, offset, { width: 16, height: 8 })
    expect(clipped.split("\n")).toHaveLength(8)
    expect(clipped.split("\n").every((row) => [...row].length === 16)).toBe(true)
  })

  test("keeps ownership rooted in spawn edges and renders a directed reply loop", () => {
    const owner = task("owner")
    const child = task("child", {
      dispatcher: { taskId: "owner", tabId: "tab-1" },
      communications: [{ targetTaskId: "owner", count: 3, lastAt: "2026-08-22T01:00:00.000Z" }],
    })
    const topology = buildAgentTopology([owner, child])
    const communication = topology.edges.find((edge) => edge.kind === "communication")

    expect(communication).toMatchObject({ from: "child", to: "owner", count: 3 })
    expect(topologyRootId(topology, "child")).toBe("owner")

    const layout = layoutAgentTopology(topology, { direction: "TB", nodeWidth: 20 })
    const edge = layout.edges.find((candidate) => candidate.kind === "communication")!
    const end = edge.points.at(-1)!
    const raster = topologyEdgeRaster(layout, "communication")
    expect(raster.join("\n")).toMatch(/◆.*[┆┄]|[┆┄].*◆/s)
    expect([...raster[end.y]!][end.x]).toBe("◁")
    expect(end.x).toBe(layout.nodes.find((node) => node.id === "owner")!.x + 20)
  })

  test("assigns separate message ports and marks every sender", () => {
    const targets = ["a", "b", "c", "d"]
    const owner = task("owner", {
      communications: targets.map((targetTaskId) => ({
        targetTaskId,
        count: 1,
        lastAt: "2026-08-22T01:00:00.000Z",
      })),
    })
    const children = targets.map((id) => task(id, { dispatcher: { taskId: "owner", tabId: `tab-${id}` } }))
    for (const direction of ["TB", "LR"] as const) {
      const layout = layoutAgentTopology(buildAgentTopology([owner, ...children]), { direction, nodeWidth: 20 })
      const messages = layout.edges.filter((edge) => edge.kind === "communication")
      const sourcePorts = messages.map((edge) => edge.points[0]!)
      const raster = topologyEdgeRaster(layout, "communication")

      expect(new Set(sourcePorts.map((point) => `${point.x}:${point.y}`)).size).toBe(4)
      for (const point of sourcePorts) expect([...raster[point.y]!][point.x]).toBe("◆")
    }
  })

  test("keeps compact batch ids", () => {
    expect(shortGroupId("01ABCDEFGHIJK")).toBe("DEFGHIJK")
  })
})
