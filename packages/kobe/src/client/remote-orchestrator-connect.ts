/**
 * The daemon handshake for `RemoteOrchestrator.init()` plus the reconnect loop:
 * the only code that runs while there may be no daemon at all. Takes an
 * explicit {@link OrchestratorSignals} deps bag instead of `this` so handshake
 * and retry policy are testable with fakes, no socket, no real backoff.
 */

import type { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { logClient, logClientError } from "@sma1lboy/kobe-daemon/client/client-log"
import { isStaleInstallError } from "@sma1lboy/kobe-daemon/client/daemon-process"
import {
  type CellPixelSize,
  type ChannelName,
  DAEMON_PROTOCOL_VERSION,
  MIN_COMPATIBLE_PROTOCOL_VERSION,
  type SerializedTask,
  type SubscribeRole,
  isForeignDaemonHome,
  isProtocolCompatible,
} from "@sma1lboy/kobe-daemon/daemon/protocol"
import { homeDir } from "../env.ts"
import { type OrchestratorSignals, deserializeTask } from "./remote-orchestrator-payloads.ts"

export interface PerformInitOptions {
  readonly role: SubscribeRole
  /** Measured cell size to report with `subscribe`; `null` when unmeasurable. */
  readonly cellPixelSize?: CellPixelSize | null
  readonly channels?: readonly ChannelName[]
  /** `false` when a channel filter excludes `task.snapshot` — skip hello task hydration. */
  readonly subscribesTasks: boolean
  /** True for a MACHINE connection (remote daemon over an SSH tunnel), where a
   *  different `homeDir` is expected and the foreign-home guard is skipped. */
  readonly expectForeignHome?: boolean
  /** Peer identity after a successful handshake: which host answered a forwarded socket. */
  readonly onPeerIdentity?: (peer: {
    hostname: string
    homeDir: string
    daemonPid: number
    kobeVersion: string
  }) => void
}

/**
 * Reconnect loop. A GUI (`spawnDaemon`) may spawn the daemon via
 * `ensureReachable`; a pane only retries the existing socket so helper panes
 * never defeat daemon lazy-shutdown. Failures stay silent in the UI, logged per
 * the caller's bounded policy.
 *
 * One failure is permanent: this process's install was deleted, so
 * `ensureReachable` can't resolve an entry point to re-exec. The loop reports it
 * once via `onFatal` and stops — only reinstalling fixes it.
 */
export async function runReconnectLoop(deps: {
  readonly isDisposed: () => boolean
  readonly spawnDaemon: boolean
  readonly ensureReachable: () => Promise<unknown>
  readonly init: () => Promise<void>
  readonly shouldLogAttempt: (attempt: number) => boolean
  /** Called once, then the loop stops, when retrying cannot ever succeed. */
  readonly onFatal?: (err: unknown) => void
}): Promise<void> {
  // Jitter the first GUI attempt: after a shared daemon drop every GUI wakes in
  // the same tick; staggered, the first one spawns and the rest find it live.
  let delayMs = deps.spawnDaemon ? Math.floor(Math.random() * 400) : 500
  let attempt = 0
  while (!deps.isDisposed()) {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
    if (deps.isDisposed()) break
    attempt++
    try {
      if (deps.spawnDaemon) await deps.ensureReachable()
      await deps.init()
      logClient("orch", `reconnected and re-subscribed after ${attempt} attempt(s) — task list re-synced`)
      return
    } catch (err) {
      if (isStaleInstallError(err)) {
        logClientError("orch-reconnect-fatal", err)
        deps.onFatal?.(err)
        return
      }
      // Pane failures are expected while no GUI owns a daemon; GUI failures
      // mean ensure/start itself is temporarily failing.
      if (deps.shouldLogAttempt(attempt)) logClientError("orch-reconnect", err)
      delayMs = delayMs === 0 ? 500 : Math.min(delayMs * 2, 3000)
    }
  }
}

/** Open the daemon socket, hello, subscribe to the task snapshot stream. */
export async function performInit(
  client: KobeDaemonClient,
  opts: PerformInitOptions,
  signals: OrchestratorSignals,
): Promise<void> {
  // Version check runs both ways: an OLD daemon predates the server-side check.
  const hello = await client.request<{
    tasks?: SerializedTask[]
    protocolVersion?: number
    minProtocolVersion?: number
    // BUILD version; drives the non-fatal stale-build banner, not
    // compatibility. Absent (old daemon) → never "stale".
    kobeVersion?: string
    // Absent (old daemon) → the ownership check is skipped.
    homeDir?: string
    // Absent (old daemon) → a machine falls back to its alias.
    hostname?: string
    daemonPid?: number
    // Additive channels gate on this: an old daemon doesn't advertise them, so
    // the client keeps its local polling fallback.
    capabilities?: readonly string[]
  }>("hello", {
    protocolVersion: DAEMON_PROTOCOL_VERSION,
    minProtocolVersion: MIN_COMPATIBLE_PROTOCOL_VERSION,
  })
  const daemonVersion = typeof hello.protocolVersion === "number" ? hello.protocolVersion : DAEMON_PROTOCOL_VERSION
  const daemonMin = typeof hello.minProtocolVersion === "number" ? hello.minProtocolVersion : daemonVersion
  if (
    !isProtocolCompatible({
      localVersion: DAEMON_PROTOCOL_VERSION,
      localMin: MIN_COMPATIBLE_PROTOCOL_VERSION,
      remoteVersion: daemonVersion,
      remoteMin: daemonMin,
    })
  ) {
    throw new Error(
      `Rove daemon is protocol v${daemonVersion} (min v${daemonMin}); this client is v${DAEMON_PROTOCOL_VERSION} (min v${MIN_COMPATIBLE_PROTOCOL_VERSION}). Restart the daemon (\`rove daemon restart\`) or upgrade Rove.`,
    )
  }
  // Reject a daemon serving a DIFFERENT home BEFORE believing any of its state:
  // a sandbox daemon on the production socket would hand back its empty task
  // list and blank the sidebar. Throwing keeps the reconnect loop running, so
  // the client re-syncs once the real daemon reclaims the socket. Local sockets
  // only; a tunnel to the wrong machine is caught by the identity triple below.
  const clientHome = homeDir()
  if (!opts.expectForeignHome && isForeignDaemonHome(hello.homeDir, clientHome)) {
    throw new Error(
      `Rove daemon on this socket serves ${hello.homeDir}, but this client uses ${clientHome}. A sandbox or dev daemon has taken the production socket — stop it (\`rove daemon stop\`), or unset ROVE_DAEMON_SOCKET_PATH / KOBE_DAEMON_SOCKET_PATH before starting it.`,
    )
  }
  // A patch upgrade keeps the protocol version, so the build version is the
  // only stale-daemon signal (`daemonStaleSignal()` banner). Re-set on every
  // init so reconnecting to a restarted daemon clears the banner.
  signals.setDaemonVersionSig(typeof hello.kobeVersion === "string" ? hello.kobeVersion : null)
  opts.onPeerIdentity?.({
    hostname: typeof hello.hostname === "string" ? hello.hostname : "",
    homeDir: typeof hello.homeDir === "string" ? hello.homeDir : "",
    daemonPid: typeof hello.daemonPid === "number" ? hello.daemonPid : 0,
    kobeVersion: typeof hello.kobeVersion === "string" ? hello.kobeVersion : "",
  })
  // A `reason: "restart"` daemon answered `hello` again, so the swap is over;
  // otherwise one restart would offer a reload forever.
  signals.setDaemonRestartingSig(false)
  // A channel-filtered consumer (UiPrefsSync) must not deserialize a list nobody reads.
  if (hello.tasks && opts.subscribesTasks) signals.setTasks(hello.tasks.map(deserializeTask))
  // The daemon replays each channel's current value on subscribe. `role` keeps
  // helper panes out of the lazy-shutdown refcount, which counts only `gui`.
  await client.subscribe({ role: opts.role, channels: opts.channels, cellPixelSize: opts.cellPixelSize })
  // Capability-gated collectors. A capable daemon's replay lands before
  // subscribe resolves; if nothing was published yet, seed an EMPTY map (not
  // null): "trust pushes, run no local polling". Without the capability, reset
  // to null so the local poller engages — including after a downgrade reconnect.
  if (hello.capabilities?.includes("worktree.changes")) {
    if (signals.worktreeChangesAcc() === null) signals.setWorktreeChangesSig(new Map())
  } else {
    signals.setWorktreeChangesSig(null)
  }
  if (hello.capabilities?.includes("transcript.activity")) {
    if (signals.transcriptActivityAcc() === null) signals.setTranscriptActivitySig(new Map())
  } else {
    signals.setTranscriptActivitySig(null)
  }
  signals.setConnectionState("online")
  logClient("orch", `subscribed as ${opts.role} (${signals.tasksAcc().length} tasks)`)
}
