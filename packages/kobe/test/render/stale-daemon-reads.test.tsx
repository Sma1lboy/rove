/** @jsxImportSource @opentui/react */
/**
 * What the daemon-fed pages claim when a read fails.
 *
 * These outlived the daemon-disconnect banner they were written for. That
 * banner was removed — Rove keeps working with the daemon down and the socket
 * usually returns within a second, so a full-width red alert interrupted with
 * nothing to act on. What the banner was covering for is still real and still
 * needs guarding: a page must not turn a failed read into a confident green
 * claim, which is the failure this file exists to catch. The banner never fixed
 * that; it only sat on top of it.
 *
 * The remaining case in the removal's blast radius is the routines page's
 * daemon-hold chip — see the last test.
 */

import { expect, test } from "bun:test"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import type { DaemonConnectionState } from "../../src/client/remote-orchestrator-payloads"
import { createStateCell } from "../../src/lib/external-store"
import { AutomationsPage } from "../../src/tui-react/component/automations-page"
import { UpdatePage } from "../../src/tui-react/component/update-page"
import { WorkspaceFrame } from "../../src/tui-react/workspace/host-footer"
import { act, renderComponent, settle } from "./harness"

const NOW = Date.now()
const AUTOMATION = {
  id: "a1",
  name: "weekday audit",
  repo: "/x/kobe",
  prompt: "audit",
  schedule: "0 9 * * MON-FRI",
  enabled: true,
  nextRunAt: new Date(NOW + 3_600_000).toISOString(),
  missedRunGraceMinutes: 60,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
}

/** A fake orchestrator whose connection state is drivable, like the real one:
 *  the socket-close handler sets the same cell. */
function fakeOrchestrator(opts: { automations?: unknown[] } = {}) {
  const connection = createStateCell<DaemonConnectionState>("online")
  const automations = opts.automations ?? []
  // Flipped mid-test to make the NEXT poll reject, the way a closed socket
  // does — the first read has to succeed so there are rows to keep.
  let failing = false
  const orchestrator = {
    connectionStateSignal: () => connection,
    listAutomations: async () => {
      if (failing) throw new Error("daemon socket closed")
      return { automations, keepsDaemonAlive: automations.length > 0 }
    },
    automationRuns: async () => ({ runs: [] }),
    listTasks: () => [{ repo: "/x/kobe" }],
  } as unknown as RemoteOrchestrator
  return {
    orchestrator,
    connection,
    failReads: () => {
      failing = true
    },
  }
}

test("a failed registry check does not render as green up-to-date", async () => {
  // `checkLatestVersion` answers null for BOTH "fetch failed" and "suppressed",
  // so the page fell back to `latest = CURRENT_VERSION` and painted it in
  // theme.success — the network error and the good news were the same pixels.
  // Empty, not deleted: `checkLatestVersion` gates on truthiness, and biome
  // forbids `delete` on process.env (assigning undefined would store the
  // STRING "undefined", which is truthy).
  const previous = process.env.KOBE_FAKE_UPDATE ?? ""
  process.env.KOBE_FAKE_UPDATE = ""
  // No network in the render track: the fetch fails, which is the case under
  // test. Force it deterministically rather than depending on that.
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error("offline")
  }) as unknown as typeof fetch
  try {
    const { frame } = await renderComponent(<UpdatePage onClose={() => {}} />, { width: 74, height: 20 })
    await settle(150)
    const text = await frame()
    expect(text).toContain("could not reach the registry")
    expect(text).not.toContain(`latest  v${process.env.npm_package_version ?? ""}`)
  } finally {
    globalThis.fetch = realFetch
    process.env.KOBE_FAKE_UPDATE = previous
  }
})

test("WorkspaceFrame renders a banner above the pane row", async () => {
  // The frame is what every non-full-window surface mounts inside, so a banner
  // handed to it has to sit ABOVE the panes rather than inside one of them.
  // The daemon-down banner is gone; the version-skew banner still arrives
  // through this same prop, and this is the only test that pins the ordering.
  const usage = createStateCell(null)
  const orch = {
    usageSnapshotSignal: () => usage,
  } as unknown as RemoteOrchestrator
  const { frame } = await renderComponent(
    <WorkspaceFrame orchestrator={orch} banner={<text>TOP STRIP</text>}>
      <text>body</text>
    </WorkspaceFrame>,
    { width: 44, height: 8 },
  )
  const lines = (await frame()).split("\n")
  const bannerRow = lines.findIndex((line) => line.includes("TOP STRIP"))
  const bodyRow = lines.findIndex((line) => line.includes("body"))
  expect(bannerRow).toBeGreaterThanOrEqual(0)
  expect(bodyRow).toBeGreaterThan(bannerRow)
})

test("the routines page keeps its rows when a poll fails", async () => {
  // The one place the removed banner was load-bearing: `keepsDaemonAlive`
  // comes off the last SUCCESSFUL read, so with the daemon gone the green
  // "keeping the daemon awake" chip is a claim about a process that is not
  // answering. It used to be overridden by a red "daemon unreachable"; now it
  // just goes stale. Deliberate — the row data beside it is equally stale, the
  // 5s poll heals both the moment the daemon answers, and `rove doctor`
  // already names a dead daemon. This pins the swallow-and-keep behavior so a
  // future refactor can't turn a failed poll into an empty list instead.
  const { orchestrator, connection, failReads } = fakeOrchestrator({ automations: [AUTOMATION] })
  const { frame, mockInput } = await renderComponent(
    <AutomationsPage orchestrator={orchestrator} focused={true} onClose={() => {}} />,
    // notifications: the page reports failed MUTATIONS as toasts (#651), so
    // it calls useNotifications() on every render.
    { width: 74, height: 20, providers: { dialog: true, notifications: true } },
  )
  await settle(150)
  expect(await frame()).toContain("weekday audit")

  // The socket drops: the signal flips AND reads start rejecting. Both,
  // because it is the rejecting read — not the signal — that decides whether
  // the rows survive, and a test that only flips the signal passes against a
  // page that blanks its list.
  failReads()
  await act(async () => {
    connection.set("disconnected")
  })
  // `r` forces the same reload the 5s poll would, without paying 5s of wall
  // clock (bun's default per-test budget is 5s, so waiting on the interval
  // times out before the tick lands).
  await act(async () => {
    mockInput.pressKey("r")
  })
  await settle(80)
  // Stale, not blank, and no crash: the row survives the failed read.
  expect(await frame()).toContain("weekday audit")
})
