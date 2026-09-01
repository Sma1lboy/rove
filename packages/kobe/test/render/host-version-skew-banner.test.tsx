/** @jsxImportSource @opentui/react */
/**
 * The version-skew banner's MOUNT, not its rendering.
 *
 * `VersionSkewBanner` has been correct since it was written and its only
 * caller was the mock workbench — the component was fine, the product never
 * mounted it. So a test against the component alone stays green with the
 * wiring deleted, which is exactly the bug: this file mounts the REAL
 * `WorkspaceRoot` and drives `daemonStaleSignal()`, the cell the `hello`
 * handshake writes.
 *
 * Why it matters here specifically: Rove ships several times a day and the
 * daemon is a long-lived process that outlives an `npm i -g`, so "new binary,
 * old daemon" is the ordinary outcome of updating — the one state the user is
 * most likely to be in and least likely to be told about.
 */

import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import type { DaemonConnectionState } from "../../src/client/remote-orchestrator-payloads"
import { createStateCell } from "../../src/lib/external-store"
import { WorkspaceRoot } from "../../src/tui-react/workspace/host"
import { setUiEventReporter } from "../../src/tui-react/workspace/terminal-tabs-shared"
import { act, renderComponent, settle } from "./harness"

// The host is the widest mount in this track, so its two process-wide side
// effects have to be undone or they follow the whole file into later tests:
// KVProvider persists to `$KOBE_HOME_DIR` (the real ~/.rove without this),
// and the host installs a module-level UI-event reporter closed over THIS
// orchestrator, which outlives unmount.
// The env override is per-FILE, not per-test: bun runs every file in one
// process and interleaves nothing, but a `beforeEach` that snapshots the var
// would restore whatever the previous file happened to leave — `beforeAll`
// captures the value once and hands back exactly that.
let previousHome: string | undefined

beforeAll(() => {
  previousHome = process.env.KOBE_HOME_DIR
  process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-skew-banner-"))
})

afterAll(() => {
  if (previousHome === undefined) Reflect.deleteProperty(process.env, "KOBE_HOME_DIR")
  else process.env.KOBE_HOME_DIR = previousHome
})

// The reporter is per-MOUNT: the host installs one closed over its own
// orchestrator, and it outlives the unmount.
afterEach(() => {
  setUiEventReporter(null)
})

// `useAccessor` drives `useSyncExternalStore`, which re-renders whenever the
// snapshot IDENTITY changes — a getter returning a fresh `{}` each call spins
// forever. Every constant snapshot below is frozen and hoisted.
const NULL_CELL = createStateCell(null)
const EMPTY_MAP = createStateCell(new Map())
const EMPTY_ARR = createStateCell(Object.freeze([]))

/** A fake whose skew + connection cells are drivable, like the real client:
 *  `init()`'s handshake writes daemonStale, socket-close writes connection. */
function fakeOrchestrator() {
  const stale = createStateCell(false)
  const daemonVersion = createStateCell<string | null>(null)
  const connection = createStateCell<DaemonConnectionState>("online")
  const staleInstall = createStateCell<string | null>(null)
  const orchestrator = {
    connectionStateSignal: () => connection,
    staleInstallSignal: () => staleInstall,
    daemonStaleSignal: () => stale,
    daemonVersionSignal: () => daemonVersion,
    tasksSignal: () => EMPTY_ARR,
    activeTaskSignal: () => NULL_CELL,
    engineStateSignal: () => EMPTY_MAP,
    engineLifecycleSignal: () => EMPTY_MAP,
    engineTabStatesSignal: () => EMPTY_MAP,
    attentionInboxSignal: () => EMPTY_ARR,
    taskJobsSignal: () => EMPTY_MAP,
    worktreeChangesSignal: () => NULL_CELL,
    transcriptActivitySignal: () => NULL_CELL,
    transcriptActivityStore: () => NULL_CELL,
    usageSnapshotSignal: () => NULL_CELL,
    uiPrefsSignal: () => NULL_CELL,
    keybindingsRevSignal: () => NULL_CELL,
    updateSignal: () => NULL_CELL,
    tabOpenStore: () => NULL_CELL,
    tabCloseStore: () => NULL_CELL,
    uiPromptStore: () => NULL_CELL,
    noticeStore: () => NULL_CELL,
    reportUiEvent: () => {},
    reportEngineInterrupt: () => {},
    listTasks: () => [],
  } as unknown as RemoteOrchestrator
  return { orchestrator, stale, daemonVersion, connection, staleInstall }
}

async function mountHost(orchestrator: RemoteOrchestrator) {
  const handle = await renderComponent(<WorkspaceRoot orchestrator={orchestrator} />, {
    width: 80,
    height: 24,
    providers: { kv: true, focus: true, dialog: true, notifications: true },
  })
  await settle(120)
  return handle
}

test("the host mounts the skew banner and drives it from the daemon signal", async () => {
  // The wiring IS the fix: a banner fed by a hand-set prop reproduces the bug
  // instead of catching it, so the skew has to arrive the way it does in
  // production — through the cell the handshake writes.
  const { orchestrator, stale, daemonVersion } = fakeOrchestrator()
  const { frame } = await mountHost(orchestrator)
  expect(await frame()).not.toContain("DAEMON OUT OF DATE")

  await act(async () => {
    daemonVersion.set("0.9.1")
    stale.set(true)
  })
  await settle(60)
  const text = await frame()
  expect(text).toContain("DAEMON OUT OF DATE")
  // The hint must name BOTH builds and the command — "out of date" alone
  // leaves the user with nothing to do about it.
  expect(text).toContain("v0.9.1")
  expect(text).toContain("rove daemon restart")

  // And it clears itself: a restarted daemon reports the matching version, so
  // the banner has to go without anyone remounting the workspace.
  await act(async () => {
    stale.set(false)
  })
  await settle(60)
  expect(await frame()).not.toContain("DAEMON OUT OF DATE")
})

test("a socket disconnect paints no banner of its own", async () => {
  // This used to assert precedence between two banners: a red DAEMON
  // DISCONNECTED strip took the slot from the amber skew one. The red banner
  // is gone — Rove keeps working with the daemon down and the socket usually
  // returns within a second, so it interrupted with nothing to act on. What
  // is left to pin is that its removal did not take the skew banner with it:
  // a stale build is still worth saying while the socket is down, because
  // restarting the daemon is what fixes BOTH.
  const { orchestrator, stale, daemonVersion, connection } = fakeOrchestrator()
  const { frame } = await mountHost(orchestrator)
  await act(async () => {
    daemonVersion.set("0.9.1")
    stale.set(true)
    connection.set("disconnected")
  })
  await settle(60)
  const text = await frame()
  expect(text).not.toContain("DAEMON DISCONNECTED")
  expect(text).toContain("DAEMON OUT OF DATE")
})

/**
 * Issue #96, the surfacing half. A GUI running from a deleted install can
 * never start a daemon, and until now that state had no picture at all: the
 * client looked like it was reconnecting, for two days on the owner's
 * machine. Mounted through the real host and driven from the cell the
 * reconnect loop writes, for the same reason as the skew test above — a
 * banner fed a hand-set prop would pass with the wiring deleted.
 */
test("the host mounts the stale-install banner and drives it from the orchestrator", async () => {
  const { orchestrator, staleInstall } = fakeOrchestrator()
  const { frame } = await mountHost(orchestrator)
  expect(await frame()).not.toContain("ROVE INSTALL IS GONE")

  await act(async () => {
    staleInstall.set("rove: this process is running from an install that no longer exists on disk")
  })
  await settle(60)
  const text = await frame()
  expect(text).toContain("ROVE INSTALL IS GONE")
  // The remedy, not just the diagnosis — waiting is what the user was
  // already doing, so the banner has to name the thing that actually works.
  expect(text).toContain("npm install -g @sma1lboy/rove")
})

test("a gone install outranks a stale daemon build — only one banner shows", async () => {
  // Both can be true at once (a deleted install leaves whatever daemon was
  // already running, which then falls behind). They share the one banner
  // slot, and only one of them is worth acting on: restarting a daemon this
  // process cannot spawn is not a fix.
  const { orchestrator, stale, daemonVersion, staleInstall } = fakeOrchestrator()
  const { frame } = await mountHost(orchestrator)
  await act(async () => {
    daemonVersion.set("0.9.1")
    stale.set(true)
    staleInstall.set("rove: this process is running from an install that no longer exists on disk")
  })
  await settle(60)
  const text = await frame()
  expect(text).toContain("ROVE INSTALL IS GONE")
  expect(text).not.toContain("DAEMON OUT OF DATE")
})
