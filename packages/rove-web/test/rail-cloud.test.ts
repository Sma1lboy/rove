import { describe, expect, test } from "bun:test"
import { en as tasksEn, zh as tasksZh } from "@sma1lboy/rove/src/tui/i18n/messages/tasks.ts"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { TaskRow } from "rove-bridge/protocol"
import type { MachineRow } from "../src/machines-view.tsx"
import { railRows } from "../src/rail.ts"

// machines-view pulls in the i18n module, which reads browser globals at load.
const g = globalThis as Record<string, unknown>
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { language: "en-US", languages: ["en-US"], platform: "Linux", userAgent: "bun" },
})
g.window ??= globalThis
const memory = new Map<string, string>()
g.localStorage ??= {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
}
const { CloudMark, remoteLabel, rowCloud } = await import("../src/machines-view.tsx")

const task = (id: string, repo: string, extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: id, repo, kind: "task", branch: id, rank: 1, ...extra }) as TaskRow
const onMac = (id: string, repo: string, extra: Partial<TaskRow> = {}) =>
  task(id, repo, { machine: { id: "mac", label: "mac" }, ...extra })
const rove = { repoId: "github.com/me/rove" }
const mac = (state: MachineRow["state"], version: string | null = "0.9.263"): MachineRow => ({
  alias: "mac",
  hostLabel: "studio.local",
  state,
  version,
})
const words = tasksEn.machine

const rail = (machines: readonly MachineRow[]) =>
  railRows({
    tasks: [task("here", "/w/rove", rove)],
    remote: [onMac("there", "/Users/me/rove", rove)],
    machines,
    sort: "default",
    query: "",
    routines: new Set<string>(),
  }).rows

describe("the rail names no machine; a remote task carries a cloud", () => {
  test("a project merged across this machine and mac has a header with no machine text", () => {
    const head = rail([mac("online")]).find((row) => row.kind === "project")
    expect(head).toEqual({ id: "project:github.com/me/rove", kind: "project", repo: "/w/rove", label: "rove" })
    expect(JSON.stringify(head)).not.toMatch(/mac|studio/)
  })

  test("only the remote task row gets a cloud, titled with the machine's registered name and host", () => {
    const rows = rail([mac("online")])
    const clouds = rows.map((row) => [row.id, rowCloud(row, [mac("online")], words)])
    expect(clouds).toEqual([
      ["project:github.com/me/rove", null],
      ["here", null],
      ["there", "on mac (studio.local)"],
    ])
  })

  test("a machine that is not online adds its state to the cloud's text", () => {
    const [there] = rail([mac("offline")]).filter((row) => row.id === "there")
    if (!there) throw new Error("no remote row")
    expect(rowCloud(there, [mac("offline")], words)).toBe("on mac (studio.local) · offline")
    expect(rowCloud(there, [mac("mismatch", "0.9.100")], words)).toBe(
      "on mac (studio.local) · ⚠ v0.9.100 (protocol mismatch)",
    )
    expect(rowCloud(there, [mac("connecting")], words)).toBe("on mac (studio.local) · connecting…")
    // Before the machine list loads, the row's own machine label stands in.
    expect(rowCloud(there, [], words)).toBe("on mac")
    expect(remoteLabel("mac", mac("offline"), tasksZh.machine)).toBe("在 mac (studio.local) 上 · 离线")
  })

  test("the cloud mark carries its text as tooltip and aria-label", () => {
    const html = renderToStaticMarkup(createElement(CloudMark, { label: "on studio.local · offline" }))
    expect(html).toContain('class="cloud-mark"')
    expect(html).toContain('title="on studio.local · offline"')
    expect(html).toContain('aria-label="on studio.local · offline"')
    expect(html).toContain('role="img"')
    expect(html).toContain("<svg")
  })
})
