/** @jsxImportSource @opentui/react */
/**
 * The quota footer renders from a daemon snapshot only — never fetches, and
 * never occupies a row when there is nothing to show.
 */

import { expect, test } from "bun:test"
import { createStateCell } from "../../src/lib/external-store"
import type { RemoteOrchestrator } from "../../src/tui-react/../client/remote-orchestrator"
import { WorkspaceFrame } from "../../src/tui-react/workspace/host-footer"
import type { EngineQuotaUsage } from "../../src/types/engine"
import { renderComponent } from "./harness"

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

test("renders one chip per window per vendor", async () => {
  const orch = orchestratorWith(
    new Map<string, EngineQuotaUsage>([
      [
        "claude",
        {
          capturedAt: Date.now(),
          windows: [
            { kind: "session", label: "5h", percent: 42, resetsAt: IN_AN_HOUR },
            { kind: "weekly_all", label: "7d", percent: 12, resetsAt: null },
          ],
        },
      ],
      ["codex", { capturedAt: Date.now(), windows: [{ kind: "primary", label: "7d", percent: 47, resetsAt: null }] }],
    ]),
  )
  const { frame } = await renderComponent(
    <WorkspaceFrame orchestrator={orch}>
      <box />
    </WorkspaceFrame>,
    { width: 80, height: 6 },
  )
  const out = await frame()
  expect(out).toContain("5h 42%")
  expect(out).toContain("7d 12%")
  expect(out).toContain("7d 47%")
  // The footer is the LAST line — children keep the rest of the column.
  expect(out.trimEnd().split("\n").at(-1)).toContain("5h 42%")
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

test("narrow footer collapses each vendor to its session-window percent", async () => {
  const orch = orchestratorWith(
    new Map<string, EngineQuotaUsage>([
      [
        "claude",
        {
          capturedAt: Date.now(),
          windows: [
            { kind: "session", label: "5h", percent: 42, resetsAt: IN_AN_HOUR },
            { kind: "weekly_all", label: "7d", percent: 12, resetsAt: null },
          ],
        },
      ],
      ["codex", { capturedAt: Date.now(), windows: [{ kind: "primary", label: "7d", percent: 96, resetsAt: null }] }],
    ]),
  )
  const { frame } = await renderComponent(
    <WorkspaceFrame orchestrator={orch}>
      <box />
    </WorkspaceFrame>,
    { width: 46, height: 6 },
  )
  const out = await frame()
  const footer = out.trimEnd().split("\n").at(-1) ?? ""
  // One chip per vendor: tone-colored percent only — no window label, no
  // reset time, and no second window.
  expect(footer).toContain("CLAUDE 42%")
  expect(footer).toContain("CODEX 96%")
  expect(footer).not.toContain("5h")
  expect(footer).not.toContain("12%")
  expect(footer).not.toContain("→")
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

test("no reading for the active tab renders no meter at all", async () => {
  // A shell tab, a session that has not run a turn, or a vendor that does not
  // report its context window — all three read as absence, never as 0%.
  const orch = orchestratorWith(null, new Map([["t1::tab-1", { contextTokens: 124_000 }]]))
  const { frame } = await renderComponent(
    <WorkspaceFrame orchestrator={orch} activeTaskId="t1" activeTabId="tab-1">
      <text>body</text>
    </WorkspaceFrame>,
    { width: 80, height: 6 },
  )
  expect(await frame()).not.toContain("ctx")
})
