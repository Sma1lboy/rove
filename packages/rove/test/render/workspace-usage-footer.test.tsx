/** @jsxImportSource @opentui/react */
/**
 * The quota footer renders from a daemon snapshot only — never fetches, and
 * never occupies a row when there is nothing to show.
 */

import { expect, test } from "bun:test"
import type { RemoteOrchestrator } from "@sma1lboy/rove-client/client/remote-orchestrator.ts"
import { createStateCell } from "@sma1lboy/rove-core/lib/external-store.ts"
import { patchStateFile } from "@sma1lboy/rove-core/state/store.ts"
import type { EngineQuotaUsage } from "@sma1lboy/rove-core/types/engine.ts"
import { WorkspaceFrame } from "../../src/tui-react/workspace/host-footer"
import { isolateHome, renderComponent } from "./harness"

/** Minimal stand-in: the footer reads the quota map and the per-session
 *  context map, and nothing else. `context` defaults to empty so the existing
 *  quota cases keep asserting the quota half alone. */
function orchestratorWith(
  usage: ReadonlyMap<string, EngineQuotaUsage> | null,
  context: ReadonlyMap<
    string,
    { contextTokens: number; contextWindowTokens?: number; approximate?: boolean }
  > | null = null,
): RemoteOrchestrator {
  const usageCell = createStateCell(usage)
  const contextCell = createStateCell(context)
  return {
    usageSnapshotSignal: () => usageCell,
    contextUsageSignal: () => contextCell,
  } as unknown as RemoteOrchestrator
}

const IN_AN_HOUR = Date.now() + 60 * 60 * 1000

isolateHome()

test("quota stays out of the bottom bar: it lives in the rail's foot", async () => {
  const orch = orchestratorWith(
    new Map<string, EngineQuotaUsage>([
      [
        "claude",
        { capturedAt: Date.now(), windows: [{ kind: "session", label: "5h", percent: 42, resetsAt: IN_AN_HOUR }] },
      ],
    ]),
  )
  const { frame } = await renderComponent(
    <WorkspaceFrame orchestrator={orch}>
      <box />
    </WorkspaceFrame>,
    { width: 100, height: 6 },
  )
  expect(await frame()).not.toContain("42%")
})

test("renders nothing when no vendor has a snapshot", async () => {
  const { frame } = await renderComponent(
    <WorkspaceFrame orchestrator={orchestratorWith(null)}>
      <text>body</text>
    </WorkspaceFrame>,
    { width: 40, height: 4 },
  )
  const out = await frame()
  expect(out).toContain("body")
  expect(out).not.toContain("%")
})

test("the context meter renders the active tab's occupancy, and only that tab's", async () => {
  const orch = orchestratorWith(
    null,
    new Map([
      ["t1::tab-1", { contextTokens: 124_000, contextWindowTokens: 200_000 }],
      ["t1::tab-2", { contextTokens: 8_000, contextWindowTokens: 200_000 }],
    ]),
  )
  const { frame } = await renderComponent(
    <WorkspaceFrame orchestrator={orch} activeTaskId="t1" activeTabId="tab-1">
      <box />
    </WorkspaceFrame>,
    { width: 80, height: 6 },
  )
  const out = await frame()
  expect(out).toContain("ctx 62%")
  // tab-2's 4% belongs to a session the user is not looking at.
  expect(out).not.toContain("4%")
})

test("with usage set to read what is left, the context chip counts down", async () => {
  patchStateFile({ "usage.show": "left" })
  const orch = orchestratorWith(
    new Map<string, EngineQuotaUsage>([
      ["claude", { capturedAt: Date.now(), windows: [{ kind: "session", label: "5h", percent: 42, resetsAt: null }] }],
    ]),
    new Map([["t1::tab-1", { contextTokens: 124_000, contextWindowTokens: 200_000 }]]),
  )
  const { frame } = await renderComponent(
    <WorkspaceFrame orchestrator={orch} activeTaskId="t1" activeTabId="tab-1">
      <box />
    </WorkspaceFrame>,
    { width: 100, height: 6, providers: { kv: true } },
  )
  const footer = (await frame()).trimEnd().split("\n").at(-1) ?? ""
  expect(footer).toContain("ctx 38%")
})
