/** @jsxImportSource @opentui/react */
/**
 * The daemon-disconnect banner, and the two false affirmations it replaced.
 *
 * `connectionStateSignal()` was accurate and immediate from the day it was
 * written and had ZERO production readers — only tests. Every page swallowed
 * its own failed read and kept painting the last good snapshot, so a dead
 * daemon rendered as a healthy routine list with a live countdown, and a
 * failed registry fetch rendered as a green "you are up to date".
 *
 * These tests drive the SIGNAL, not a boolean prop: a banner wired to a prop
 * nobody sets is exactly the bug being fixed, so the disconnect has to arrive
 * the way it does in production — through the state cell the socket-close
 * handler writes.
 */

import { expect, test } from "bun:test"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import type { DaemonConnectionState } from "../../src/client/remote-orchestrator-payloads"
import { createStateCell } from "../../src/lib/external-store"
import { AutomationsPage } from "../../src/tui-react/component/automations-page"
import { UpdatePage } from "../../src/tui-react/component/update-page"
import { DaemonDownBanner } from "../../src/tui-react/component/version-skew-banner"
import { useDaemonDown } from "../../src/tui-react/lib/use-accessor"
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
  const orchestrator = {
    connectionStateSignal: () => connection,
    listAutomations: async () => ({ automations, keepsDaemonAlive: automations.length > 0 }),
    automationRuns: async () => ({ runs: [] }),
    listTasks: () => [{ repo: "/x/kobe" }],
  } as unknown as RemoteOrchestrator
  return { orchestrator, connection }
}

test("the banner is hidden while the daemon answers", async () => {
  const { frame } = await renderComponent(<DaemonDownBanner down={false} width={60} />)
  expect(await frame()).not.toContain("DAEMON DISCONNECTED")
})

test("the banner names the disconnect and says the screen is stale", async () => {
  const { frame } = await renderComponent(<DaemonDownBanner down={true} width={60} />)
  const text = await frame()
  expect(text).toContain("DAEMON DISCONNECTED")
  // The hint has to say what it means for what is on screen — "disconnected"
  // alone leaves the healthy-looking list beneath it unexplained.
  expect(text).toContain("last state the daemon reported")
})

test("the routines page stops claiming it holds a daemon that is gone", async () => {
  // The worst of the three: a dead daemon rendered `holding daemon` in
  // theme.success GREEN — an affirmative claim about a process that is not
  // answering, built out of the last successful read.
  const { orchestrator, connection } = fakeOrchestrator({ automations: [AUTOMATION] })
  const { frame } = await renderComponent(
    <AutomationsPage orchestrator={orchestrator} focused={true} onClose={() => {}} />,
    // notifications: the page reports failed MUTATIONS as toasts (#651), so
    // it calls useNotifications() on every render.
    { width: 74, height: 20, providers: { dialog: true, notifications: true } },
  )
  await settle(150)
  expect(await frame()).toContain("keeping the daemon awake")

  await act(async () => {
    connection.set("disconnected")
  })
  await settle(60)
  const text = await frame()
  expect(text).not.toContain("keeping the daemon awake")
  expect(text).toContain("daemon unreachable")
})

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

test("useDaemonDown follows the orchestrator's real connection signal", async () => {
  // The wiring is the fix. `connectionStateSignal()` was correct for months
  // with nothing reading it, so a banner driven by a hand-set prop would
  // reproduce the bug rather than catch it: this asserts the hook reads the
  // ACTUAL signal, and re-renders when the socket-close handler writes it.
  const { orchestrator, connection } = fakeOrchestrator()
  function Probe() {
    return <text>{useDaemonDown(orchestrator) ? "down" : "up"}</text>
  }
  const { frame } = await renderComponent(<Probe />, { width: 20, height: 3 })
  expect(await frame()).toContain("up")

  await act(async () => {
    connection.set("disconnected")
  })
  expect(await frame()).toContain("down")

  // And back: the reconnect loop sets "online" after a successful re-init, so
  // the banner has to clear itself without anyone remounting the page.
  await act(async () => {
    connection.set("online")
  })
  expect(await frame()).toContain("up")
})

test("useDaemonDown reports up with no orchestrator at all", async () => {
  // A page can mount before the daemon connect resolves. "No orchestrator" is
  // not evidence of a disconnect — flashing the banner there would train the
  // user to ignore it.
  function Probe() {
    return <text>{useDaemonDown(null) ? "down" : "up"}</text>
  }
  const { frame } = await renderComponent(<Probe />, { width: 20, height: 3 })
  expect(await frame()).toContain("up")
})

test("WorkspaceFrame renders the banner above the pane row", async () => {
  // The frame is what every non-full-window surface mounts inside, so the
  // banner has to sit ABOVE the panes rather than inside one of them.
  const usage = createStateCell(null)
  const orch = {
    usageSnapshotSignal: () => usage,
  } as unknown as RemoteOrchestrator
  const { frame } = await renderComponent(
    <WorkspaceFrame orchestrator={orch} banner={<DaemonDownBanner down={true} width={40} />}>
      <text>body</text>
    </WorkspaceFrame>,
    { width: 44, height: 8 },
  )
  const lines = (await frame()).split("\n")
  const bannerRow = lines.findIndex((line) => line.includes("DAEMON DISCONNECTED"))
  const bodyRow = lines.findIndex((line) => line.includes("body"))
  expect(bannerRow).toBeGreaterThanOrEqual(0)
  expect(bodyRow).toBeGreaterThan(bannerRow)
})
