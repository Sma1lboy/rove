/**
 * The orchestrator's own CONTRACT — what a `RemoteOrchestrator` is configured
 * with ({@link RemoteOrchestratorOptions}), the deps bag its three helper
 * modules operate on ({@link OrchestratorSignals}), and the connection-state
 * vocabulary they share.
 *
 * Split from `-payloads.ts`, which owns the daemon's payload SHAPES and the
 * pure functions that parse and compare them. These describe the orchestrator
 * instead — none of them appears on the wire — and they were only sitting
 * there because that was the file both sides already imported. Re-exported
 * through `-payloads.ts` so every existing import path is unchanged.
 */

import type { ChannelName, NoticeEventPayload, SubscribeRole } from "@sma1lboy/kobe-daemon/daemon/protocol"
import type {
  CellPixelSize,
  TabClosePayload,
  TabOpenPayload,
  TabRenamePayload,
  UiPrefsPayload,
  UiPromptPayload,
} from "@sma1lboy/kobe-daemon/daemon/protocol"
import type { ReadableState } from "../lib/external-store.ts"
import type { Task } from "../types/task.ts"
import type { UpdateInfo } from "../version.ts"
import type {
  AttentionInboxItem,
  ContextUsageMap,
  EngineLifecycleMap,
  EngineTabStateMap,
  RowTokenMap,
  TaskEngineState,
  TaskJobState,
  TranscriptActivityMap,
  UsageSnapshotMap,
  WorktreeChangesMap,
} from "./remote-orchestrator-payloads.ts"

/** Daemon connection lifecycle as observed by the TUI during silent recovery. */
export type DaemonConnectionState = "online" | "disconnected"

export interface RemoteOrchestratorOptions {
  /**
   * True for a MACHINE connection: the daemon on the far end of an SSH tunnel
   * serves its OWN home, so the foreign-home guard must not fire. Defaults to
   * false, which keeps every local connection's behaviour unchanged.
   */
  readonly expectForeignHome?: boolean
  /** Told who answered the handshake — hostname / homeDir / daemonPid, the
   *  triple that identifies a machine (`machines/registry.ts`). */
  readonly onPeerIdentity?: (peer: {
    hostname: string
    homeDir: string
    daemonPid: number
    kobeVersion: string
  }) => void
  /**
   * Bring the daemon back on the socket this client already points
   * at. Shared mode uses the stable production socket; single/owned
   * mode injects a restart function for its per-TUI socket.
   */
  readonly ensureReachable?: () => Promise<unknown>
  /**
   * Subscribe role (KOB). `"gui"` keeps the daemon alive while this
   * orchestrator is connected — pass it only from a real front-end attach
   * (`direct.ts`, the outer monitor). Default `"pane"`: an in-tmux helper
   * (Tasks pane, Ops, settings/new-task windows) subscribes for data but
   * never holds the daemon open after the user quits. See {@link SubscribeRole}.
   */
  readonly role?: SubscribeRole
  /**
   * Per-channel subscribe filter (KOB — per-channel subscribe). Omit to
   * receive EVERY channel (the default — what a primary orchestrator
   * driving the task list needs). Pass a narrow set for a single-purpose
   * consumer: host-boot's UiPrefsSync passes `["ui-prefs", "keybindings"]`
   * so it never receives — nor deserializes — the full `task.snapshot`
   * fan-out it does not read. When the filter excludes `task.snapshot`, the
   * `hello` task hydration is also skipped (the task list would be dead
   * weight), and `worktreeChangesSignal()` is left null (its consumer isn't
   * subscribed). An older daemon ignores the filter and sends everything;
   * the unread channels simply land in signals nobody reads — still cheaper
   * to ask, and correct.
   */
  readonly channels?: readonly ChannelName[]
  /**
   * This terminal's cell size in pixels, measured at boot (`queryCellPixelSize`),
   * or `null` when the terminal declined to report one. Sent with `subscribe`
   * so the daemon can answer a `graphics.write` caller with it. Only a `"gui"`
   * attach owns a real tty, so only a gui should pass it.
   */
  readonly cellPixelSize?: CellPixelSize | null
  /**
   * Where a `graphics.write` payload is written. Defaults to this process's own
   * fd 1 for a `"gui"` attach, and to nowhere otherwise — a pane has no tty of
   * its own worth writing pictures to. Injectable so a test can observe the
   * bytes without a terminal.
   */
  readonly graphicsOut?: (data: Buffer) => void
}

/**
 * The accessor/setter closures `handleOrchestratorEvent` and `performInit`
 * operate on, threaded in by `RemoteOrchestrator` instead of `this`. Built
 * once in the constructor from the same Solid signals the class's own
 * read-signal methods return.
 */
export interface OrchestratorSignals {
  /**
   * Write one `graphics.write` payload out, verbatim. Not a signal: a picture
   * is an ACT on the terminal, not a value to hold — storing the last one and
   * re-rendering it would replay it on every reconnect.
   */
  readonly writeGraphics: (data: Buffer) => void
  readonly tasksAcc: ReadableState<Task[]>
  readonly setTasks: (next: Task[]) => void
  readonly setActiveTaskSig: (next: string | null) => void
  readonly setUpdateSig: (next: UpdateInfo | null) => void
  readonly setDaemonVersionSig: (next: string | null) => void
  /** True from a `daemon.stopping` frame that named `reason: "restart"`
   *  until the next successful handshake — see `daemonRestartingSignal`. */
  readonly setDaemonRestartingSig: (next: boolean) => void
  readonly engineStateAcc: ReadableState<ReadonlyMap<string, TaskEngineState>>
  readonly setEngineStateSig: (next: ReadonlyMap<string, TaskEngineState>) => void
  readonly engineTabStateAcc: ReadableState<EngineTabStateMap>
  readonly setEngineTabStateSig: (next: EngineTabStateMap) => void
  readonly setAttentionInboxSig: (next: readonly AttentionInboxItem[]) => void
  readonly taskJobsAcc: ReadableState<ReadonlyMap<string, TaskJobState>>
  readonly setTaskJobsSig: (next: ReadonlyMap<string, TaskJobState>) => void
  readonly rowTokensAcc: ReadableState<RowTokenMap>
  readonly setRowTokensSig: (next: RowTokenMap) => void
  readonly worktreeChangesAcc: ReadableState<WorktreeChangesMap | null>
  readonly setWorktreeChangesSig: (next: WorktreeChangesMap | null) => void
  readonly usageSnapshotAcc: ReadableState<UsageSnapshotMap | null>
  readonly setUsageSnapshotSig: (next: UsageSnapshotMap | null) => void
  readonly contextUsageAcc: ReadableState<ContextUsageMap | null>
  readonly setContextUsageSig: (next: ContextUsageMap | null) => void
  readonly transcriptActivityAcc: ReadableState<TranscriptActivityMap | null>
  readonly setTranscriptActivitySig: (next: TranscriptActivityMap | null) => void
  readonly setNoticeSig: (next: NoticeEventPayload | null) => void
  readonly setTabOpenSig: (next: TabOpenPayload | null) => void
  readonly setTabCloseSig: (next: TabClosePayload | null) => void
  readonly setTabRenameSig: (next: TabRenamePayload | null) => void
  readonly setUiPromptSig: (next: UiPromptPayload | null) => void
  readonly engineLifecycleAcc: ReadableState<EngineLifecycleMap>
  readonly setEngineLifecycleSig: (next: EngineLifecycleMap) => void
  readonly setUiPrefsSig: (next: UiPrefsPayload | null) => void
  readonly setKeybindingsRevSig: (next: number | null) => void
  readonly setConnectionState: (next: DaemonConnectionState) => void
}

/**
 * How many failed attempts the pane reconnect loop keeps logging
 * (`orch-reconnect`) before it goes quiet. Issue #26: a daemon that stays
 * down for days with dozens of orphan panes each retrying forever was
 * still unbounded spam even at "attempt 1 and every 10th" — that decays
 * the RATE but never stops. A hard ceiling actually bounds it.
 */
export const RECONNECT_LOG_ATTEMPT_CEILING = 100

/**
 * Pure decision: should this failed reconnect attempt be logged? Attempt 1
 * and every 10th up to {@link RECONNECT_LOG_ATTEMPT_CEILING}; silent after
 * that until a successful reconnect resets the caller's attempt counter
 * back to 0. Exported for unit tests.
 */
export function shouldLogReconnectAttempt(attempt: number): boolean {
  if (attempt > RECONNECT_LOG_ATTEMPT_CEILING) return false
  return attempt === 1 || attempt % 10 === 0
}
