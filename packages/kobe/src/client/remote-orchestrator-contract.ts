/**
 * `RemoteOrchestrator`'s own contract: its options, the deps bag its helper
 * modules operate on, and the connection-state vocabulary. None of it is on
 * the wire (wire shapes live in `-payloads.ts`, which re-exports these).
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
  /** True for a MACHINE connection: the daemon across an SSH tunnel serves
   *  its OWN home, so the foreign-home guard must not fire. */
  readonly expectForeignHome?: boolean
  /** Told who answered the handshake — hostname / homeDir / daemonPid, the
   *  triple that identifies a machine (`machines/registry.ts`). */
  readonly onPeerIdentity?: (peer: {
    hostname: string
    homeDir: string
    daemonPid: number
    kobeVersion: string
  }) => void
  /** Bring the daemon back on this client's socket (single/owned mode injects
   *  a restart for its per-TUI socket). */
  readonly ensureReachable?: () => Promise<unknown>
  /** `"gui"` keeps the daemon alive while connected — only a real front-end
   *  attach passes it. Default `"pane"` never holds the daemon open after the
   *  user quits. See {@link SubscribeRole}. */
  readonly role?: SubscribeRole
  /**
   * Per-channel subscribe filter; omit for EVERY channel. A narrow consumer
   * (e.g. UiPrefsSync: `["ui-prefs", "keybindings"]`) never deserializes the
   * `task.snapshot` fan-out. Excluding `task.snapshot` also skips `hello`
   * task hydration and leaves `worktreeChangesSignal()` null. An older daemon
   * ignores the filter; the extra channels land unread, still correct.
   */
  readonly channels?: readonly ChannelName[]
  /** Cell size in pixels measured at boot, `null` if the terminal declined.
   *  Sent with `subscribe` for `graphics.write` callers; gui attaches only
   *  (only they own a real tty). */
  readonly cellPixelSize?: CellPixelSize | null
  /** Where `graphics.write` payloads go: fd 1 for a `"gui"` attach, nowhere
   *  otherwise. Injectable for tests. */
  readonly graphicsOut?: (data: Buffer) => void
}

/**
 * Accessor/setter closures `handleOrchestratorEvent` and `performInit` use in
 * place of `this`; built once from the same state the class's read methods return.
 */
export interface OrchestratorSignals {
  /** Write one `graphics.write` payload verbatim. Not a signal: storing a
   *  picture would replay it on every reconnect. */
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
 * Failed reconnect attempts logged (`orch-reconnect`) before going quiet. A
 * decaying rate alone never stops: orphan panes retrying for days against a
 * dead daemon would still spam forever.
 */
export const RECONNECT_LOG_ATTEMPT_CEILING = 100

/** Log attempt 1 and every 10th up to the ceiling; the caller resets the count on reconnect. */
export function shouldLogReconnectAttempt(attempt: number): boolean {
  if (attempt > RECONNECT_LOG_ATTEMPT_CEILING) return false
  return attempt === 1 || attempt % 10 === 0
}
