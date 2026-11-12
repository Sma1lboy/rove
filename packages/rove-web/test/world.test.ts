import { expect, test } from "bun:test"
import { BeatLog, hotFiles, toolTally } from "../src/world/beats.ts"
import { agentSeat, stationGrid } from "../src/world/iso.ts"
import { shortToolName, toolKind } from "../src/world/tool-kinds.ts"
import { hueOf, isWorking, worldStations } from "../src/world/world-data.ts"

test("stations fill a serpentine grid, each slot its own", () => {
  const slots = stationGrid(6, 3)
  expect(new Set(slots.map((s) => `${s.x},${s.z}`)).size).toBe(6)
  // The second row runs the other way, so a long row stays on screen.
  expect(slots[3].x).toBeGreaterThan(slots[5].x)
  // Centred on the origin: no station drifts off-screen as tasks come and go.
  const meanZ = slots.reduce((sum, s) => sum + s.z, 0) / slots.length
  expect(Math.abs(meanZ)).toBeLessThan(1e-9)
  expect(stationGrid(0)).toEqual([])
})

test("agents sit around the station without sharing a seat", () => {
  const seats = [0, 1, 2].map((i) => agentSeat(i, 3))
  expect(new Set(seats.map((s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`)).size).toBe(3)
  for (const seat of seats) expect(Math.hypot(seat.x, seat.z)).toBeGreaterThan(1.5)
})

test("tool names map to the five kinds, vendor prefixes and all", () => {
  expect(toolKind("Read")).toBe("scan")
  expect(toolKind("Grep")).toBe("scan")
  expect(toolKind("Edit")).toBe("build")
  expect(toolKind("apply_patch")).toBe("build")
  expect(toolKind("Bash")).toBe("run")
  expect(toolKind("shell")).toBe("run")
  expect(toolKind("Task")).toBe("plan")
  expect(toolKind("mcp__fortune__roll")).toBe("other")
  expect(shortToolName("mcp__fortune__roll")).toBe("ROLL")
  expect(shortToolName("NotebookEdit")).toBe("NOTEBOOK…")
})

test("a re-read page never replays a beat; new calls arrive in order", () => {
  const log = new BeatLog(4)
  const call = (id: string, name = "Read", input: unknown = { file_path: "/repo/src/a.ts" }) => ({
    role: "assistant",
    blocks: [{ type: "tool_call", callId: id, name, input }],
  })
  const first = log.ingest([call("c1"), call("c2")], 1000)
  expect(first.map((b) => b.id)).toEqual(["c1", "c2"])
  expect(log.ingest([call("c1"), call("c2"), call("c3")], 2000).map((b) => b.id)).toEqual(["c3"])
  expect(log.ingest([{ role: "user", blocks: [{ type: "text", text: "hi" }] }], 3000)).toEqual([])
  // The cap drops the oldest beats and forgets them, so a very old call can land again.
  log.ingest([call("c4"), call("c5"), call("c6")], 4000)
  expect(log.recent(2).map((b) => b.id)).toEqual(["c6", "c5"])
  expect(log.count).toBe(4)
})

test("the panels count tools and files from the beats they were given", () => {
  const log = new BeatLog()
  log.ingest(
    [
      {
        role: "assistant",
        blocks: [
          { type: "tool_call", callId: "a", name: "Read", input: { file_path: "/r/src/x.ts" } },
          { type: "tool_call", callId: "b", name: "Edit", input: { file_path: "/r/src/x.ts" } },
          { type: "tool_call", callId: "c", name: "Read", input: { file_path: "/r/src/y.ts" } },
        ],
      },
    ],
    1,
  )
  const beats = log.recent(10)
  expect(toolTally(beats)).toEqual([
    { name: "Read", count: 2 },
    { name: "Edit", count: 1 },
  ])
  expect(hotFiles(beats)[0]).toEqual({ file: "src/x.ts", count: 2 })
})

test("a station carries its task's name, hue, sessions and running state", () => {
  const row = (id: string, label: string, kind: string) => ({
    id,
    title: label,
    label,
    branch: "b",
    repo: "/r",
    kind: "worktree",
    status: "active",
    group: "active",
    rank: 0,
    activity: null,
    engine: { id: "claude", name: "Claude" },
    pr: null,
    report: null,
    deleting: false,
    rowStatus: { kind, since: 5 },
  })
  const payload = {
    tasks: [row("t1", "alpha", "running"), row("t2", "beta", "idle"), { ...row("t3", "gone", "idle"), deleting: true }],
  }
  const tabs = {
    t1: [{ id: "tab-1", kind: "engine", title: null, engineName: "Claude", conversation: null, alive: true }],
  }
  const stations = worldStations(payload as never, tabs as never, new Map([["t1", 7]]))
  expect(stations.map((s) => s.label)).toEqual(["alpha", "beta"])
  expect(stations[0].status).toBe("running")
  expect(stations[0].calls).toBe(7)
  expect(stations[0].agents).toEqual([{ id: "tab-1", engine: "Claude", alive: true }])
  expect(stations[0].hue).toBe(hueOf("t1"))
  expect(isWorking(payload.tasks[0] as never)).toBe(true)
  expect(isWorking(payload.tasks[1] as never)).toBe(false)
})
