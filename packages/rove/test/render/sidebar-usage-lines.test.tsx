/** @jsxImportSource @opentui/react */
import { expect, test } from "bun:test"
import { createStateCell } from "@sma1lboy/rove-core/lib/external-store.ts"
import { patchStateFile } from "@sma1lboy/rove-core/state/store.ts"
import type { UsageSnapshotMap } from "../../src/client/remote-orchestrator-payloads"
import { SidebarUsageLines } from "../../src/tui-react/panes/sidebar/usage-lines"
import { isolateHome, renderComponent } from "./harness"

isolateHome()

const window = (kind: string, label: string, percent: number) => ({ kind, label, percent, resetsAt: null })

test("the rail's foot draws one quota line per engine, figures in one column", async () => {
  const usage = createStateCell<UsageSnapshotMap | null>(
    new Map([
      ["claude", { capturedAt: Date.now(), windows: [window("weekly", "7d", 80), window("session", "5h", 50)] }],
      ["codex", { capturedAt: Date.now(), windows: [window("session", "5h", 5)] }],
    ]) as unknown as UsageSnapshotMap,
  )
  const { frame } = await renderComponent(<SidebarUsageLines usage={usage} width={30} />, { width: 30, height: 4 })
  const lines = (await frame()).split("\n")
  // The session window, half of a 14-cell line filled; the narrower figure is right-aligned under it.
  expect(lines[0]).toBe(" Claude ━━━━━━━━━━━━━━ 5h 50% ")
  expect(lines[1]).toBe(" Codex  ━━━━━━━━━━━━━━  5h 5% ")
})

test("with usage set to read what is left, the figure counts down", async () => {
  patchStateFile({ "usage.show": "left" })
  const usage = createStateCell<UsageSnapshotMap | null>(
    new Map([
      ["claude", { capturedAt: Date.now(), windows: [window("session", "5h", 42)] }],
    ]) as unknown as UsageSnapshotMap,
  )
  const { frame } = await renderComponent(<SidebarUsageLines usage={usage} width={30} />, {
    width: 30,
    height: 2,
    providers: { kv: true },
  })
  expect(await frame()).toContain("5h 58%")
})
