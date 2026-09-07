/**
 * RemoteOrchestrator mirrors the slim {@link Orchestrator} that
 * runs in the daemon: same read surface (tasks signal + subscribe), and a
 * write surface forwarding each method as a daemon RPC.
 *
 * The wire boundary: `performInit`/`handleOrchestratorEvent`
 * (`remote-orchestrator-connect.ts`/`-events.ts`) take an explicit
 * {@link OrchestratorSignals} deps bag — built once in the constructor from
 * the same framework-free state cells this class's read methods return — instead of
 * closing over `this`. Write methods below are 1-line delegates to
 * `remote-orchestrator-writes.ts`. Wire-payload types/helpers live in
 * `remote-orchestrator-payloads.ts`, re-exported below for existing importers.
 */

import type { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { logClient, logClientError } from "@sma1lboy/kobe-daemon/client/client-log"
import { ensureDaemonReachable } from "@sma1lboy/kobe-daemon/client/daemon-process"
import type { DaemonRpcClient } from "@sma1lboy/kobe-daemon/client/rpc"
import type { RepoIssues } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import {
  type ChannelName,
  type NoticeEventPayload,
  type SubscribeRole,
  type TabClosePayload,
  type TabOpenPayload,
  type TabRenamePayload,
  type UiPrefsPayload,
  type UiPromptPayload,
  isDaemonVersionStale,
} from "@sma1lboy/kobe-daemon/daemon/protocol"
import { type ExternalStore, type ReadableState, createStateCell, mapReadableState } from "../lib/external-store.ts"
import type { Orchestrator, Unsubscribe } from "../orchestrator/core.ts"
import type { WorktreeResidue } from "../orchestrator/worktree/manager-remove.ts"
import type { Task, TaskId, TaskStatus, VendorId } from "../types/task.ts"
import type { AdoptableWorktree, WorktreeProject } from "../types/worktree.ts"
import { CURRENT_VERSION, type UpdateInfo } from "../version.ts"
import { performInit, runReconnectLoop } from "./remote-orchestrator-connect.ts"
import { handleOrchestratorEvent } from "./remote-orchestrator-events.ts"
import {
  type AttentionInboxItem,
  type ContextUsageMap,
  type DaemonConnectionState,
  type EngineLifecycleMap,
  type EngineTabStateMap,
  type OrchestratorSignals,
  type RecentTaskEvent,
  type RemoteOrchestratorOptions,
  type TaskEngineState,
  type TaskJobState,
  type TranscriptActivityMap,
  type UsageSnapshotMap,
  type WorktreeChangesMap,
  shouldLogReconnectAttempt,
} from "./remote-orchestrator-payloads.ts"
import { subscribeTasksOp } from "./remote-orchestrator-reads.ts"
import * as writes from "./remote-orchestrator-writes.ts"

export type {
  AttentionInboxItem,
  DaemonConnectionState,
  EngineLifecycleMap,
  EngineTabStateMap,
  RecentTaskEvent,
  RemoteOrchestratorOptions,
  TaskEngineState,
  TaskJobState,
  TranscriptActivity,
  TranscriptActivityMap,
  UsageSnapshotMap,
  WorktreeChangesMap,
} from "./remote-orchestrator-payloads.ts"
export {
  decodeUiPrefsPayload,
  parseTranscriptActivityPayload,
  parseWorktreeChangesPayload,
  sameTranscriptActivityMap,
  sameWorktreeChangesMap,
} from "./remote-orchestrator-payloads.ts"

export type KobeOrchestrator = Orchestrator | RemoteOrchestrator

export class RemoteOrchestrator {
  private readonly tasksAcc = createStateCell<Task[]>([], "orchestrator.tasks")
  private readonly activeTaskAcc = createStateCell<string | null>(null, "orchestrator.active-task")
  private readonly updateAcc = createStateCell<UpdateInfo | null>(null)
  private readonly daemonVersionAcc = createStateCell<string | null>(null)
  /** Set by a `daemon.stopping` frame naming `reason: "restart"`, cleared by
   *  the next successful handshake — see {@link daemonRestartingSignal}. */
  private readonly daemonRestartingAcc = createStateCell<boolean>(false)
  private readonly daemonStaleAcc = mapReadableState(this.daemonVersionAcc, (version) =>
    isDaemonVersionStale(version ?? undefined, CURRENT_VERSION),
  )
  private readonly engineStateAcc = createStateCell<ReadonlyMap<string, TaskEngineState>>(new Map())
  private readonly engineTabStateAcc = createStateCell<EngineTabStateMap>(new Map())
  private readonly attentionInboxAcc = createStateCell<readonly AttentionInboxItem[]>([])
  private readonly taskJobsAcc = createStateCell<ReadonlyMap<string, TaskJobState>>(new Map())
  private readonly worktreeChangesAcc = createStateCell<WorktreeChangesMap | null>(null)
  private readonly usageSnapshotAcc = createStateCell<UsageSnapshotMap | null>(null)
  private readonly contextUsageAcc = createStateCell<ContextUsageMap | null>(null)
  private readonly transcriptActivityAcc = createStateCell<TranscriptActivityMap | null>(null)
  private readonly noticeAcc = createStateCell<NoticeEventPayload | null>(null)
  private readonly tabOpenAcc = createStateCell<TabOpenPayload | null>(null)
  private readonly tabCloseAcc = createStateCell<TabClosePayload | null>(null)
  private readonly tabRenameAcc = createStateCell<TabRenamePayload | null>(null)
  private readonly uiPromptAcc = createStateCell<UiPromptPayload | null>(null)
  private readonly engineLifecycleAcc = createStateCell<EngineLifecycleMap>(new Map())
  private readonly uiPrefsAcc = createStateCell<UiPrefsPayload | null>(null)
  private readonly keybindingsRevAcc = createStateCell<number | null>(null)
  private readonly connectionStateAcc = createStateCell<DaemonConnectionState>("online", "orchestrator.connection")
  /** Set once, by the reconnect loop giving up — see {@link staleInstallSignal}. */
  private readonly staleInstallAcc = createStateCell<string | null>(null)
  private readonly ensureReachable: () => Promise<unknown>
  private readonly role: SubscribeRole
  /** Per-channel subscribe filter; `undefined` = subscribe to all channels. */
  private readonly channels?: readonly ChannelName[]
  /** True when the filter excludes `task.snapshot` — skip hello task hydration. */
  private readonly subscribesTasks: boolean
  /** One shared retry task: repeated close events and an explicit reconnect
   *  join the same loop instead of racing two hello/subscribe handshakes. */
  private reconnectTask: Promise<void> | null = null
  /** Deps bag for `performInit`/`handleOrchestratorEvent` — see file header. */
  private readonly signals: OrchestratorSignals

  constructor(
    private readonly client: KobeDaemonClient,
    options: RemoteOrchestratorOptions = {},
  ) {
    this.ensureReachable = options.ensureReachable ?? ensureDaemonReachable
    this.role = options.role ?? "pane"
    this.channels = options.channels
    this.subscribesTasks = !options.channels || options.channels.includes("task.snapshot")
    this.signals = {
      tasksAcc: this.tasksAcc,
      setTasks: this.tasksAcc.set,
      setActiveTaskSig: this.activeTaskAcc.set,
      setUpdateSig: this.updateAcc.set,
      setDaemonVersionSig: this.daemonVersionAcc.set,
      setDaemonRestartingSig: this.daemonRestartingAcc.set,
      engineStateAcc: this.engineStateAcc,
      setEngineStateSig: this.engineStateAcc.set,
      engineTabStateAcc: this.engineTabStateAcc,
      setEngineTabStateSig: this.engineTabStateAcc.set,
      setAttentionInboxSig: this.attentionInboxAcc.set,
      taskJobsAcc: this.taskJobsAcc,
      setTaskJobsSig: this.taskJobsAcc.set,
      worktreeChangesAcc: this.worktreeChangesAcc,
      setWorktreeChangesSig: this.worktreeChangesAcc.set,
      usageSnapshotAcc: this.usageSnapshotAcc,
      setUsageSnapshotSig: this.usageSnapshotAcc.set,
      contextUsageAcc: this.contextUsageAcc,
      setContextUsageSig: this.contextUsageAcc.set,
      transcriptActivityAcc: this.transcriptActivityAcc,
      setTranscriptActivitySig: this.transcriptActivityAcc.set,
      setNoticeSig: this.noticeAcc.set,
      setTabOpenSig: this.tabOpenAcc.set,
      setTabCloseSig: this.tabCloseAcc.set,
      setTabRenameSig: this.tabRenameAcc.set,
      setUiPromptSig: this.uiPromptAcc.set,
      engineLifecycleAcc: this.engineLifecycleAcc,
      setEngineLifecycleSig: this.engineLifecycleAcc.set,
      setUiPrefsSig: this.uiPrefsAcc.set,
      setKeybindingsRevSig: this.keybindingsRevAcc.set,
      setConnectionState: this.connectionStateAcc.set,
    }
    this.client.on("*", (frame) => handleOrchestratorEvent(frame.name, frame.payload, this.signals))
    // Socket drop flips us to `disconnected`. What happens next depends on
    // the role:
    //   - gui:  AUTO-RECOVER (spawning). This is the front-end that owns daemon
    //     availability, so it silently ensures a daemon is running, reconnects,
    //     and re-subscribes until the current snapshot has been replayed.
    //   - pane: AUTO-RECONNECT (non-spawning). An in-tmux pane DOES routinely
    //     lose its daemon — the refcounted lazy-shutdown idle-stops the daemon
    //     3s after the last gui quits, while the pane persists with the tmux
    //     session. Without reconnect the pane's task list froze forever at the
    //     last snapshot (the create/delete sync drift). The loop reconnects to
    //     the SAME socket when a daemon returns and re-subscribes → the bus
    //     replays the current task.snapshot → the pane re-syncs. It must NOT
    //     spawn a daemon (that would resurrect an idle-stopped daemon and break
    //     lazy-shutdown — panes alone never hold it alive), so it only retries
    //     a plain connect, never `ensureReachable`.
    this.client.onLifecycle("close", () => {
      this.connectionStateAcc.set("disconnected")
      const spawnDaemon = this.role === "gui"
      logClient(
        "orch",
        spawnDaemon
          ? "daemon socket closed — starting silent spawning reconnect loop"
          : "daemon socket closed — starting non-spawning reconnect loop",
      )
      void this.reconnectLoop(spawnDaemon)
    })
  }

  /**
   * Start or join the role-appropriate reconnect loop. The body lives in
   * `remote-orchestrator-connect.ts` `runReconnectLoop`, over an explicit deps
   * bag, so the retry policy is testable without a daemon; this method only
   * supplies this instance's dependencies. On success subscribe replay
   * rehydrates every signal, including the current task snapshot.
   */
  private reconnectLoop(spawnDaemon: boolean): Promise<void> {
    if (this.reconnectTask) return this.reconnectTask
    const task = runReconnectLoop({
      isDisposed: () => this.client.isDisposed,
      spawnDaemon,
      ensureReachable: this.ensureReachable,
      init: () => this.init(),
      shouldLogAttempt: shouldLogReconnectAttempt,
      onFatal: (err) => this.staleInstallAcc.set(err instanceof Error ? err.message : String(err)),
    })
    this.reconnectTask = task
    const clear = (): void => {
      if (this.reconnectTask === task) this.reconnectTask = null
    }
    task.then(clear, clear)
    return task
  }

  /** Open the daemon socket, hello, subscribe to the task snapshot stream. */
  async init(): Promise<void> {
    await performInit(
      this.client,
      { role: this.role, channels: this.channels, subscribesTasks: this.subscribesTasks },
      this.signals,
    )
  }

  connectionStateSignal(): ReadableState<DaemonConnectionState> {
    return this.connectionStateAcc
  }

  /** The reconnect loop's one terminal failure, as a message: non-null once
   *  this process is confirmed to be running from a deleted install. Latched,
   *  never cleared — only a reinstall clears it, and the alternative is what
   *  a stale install already looked like: "reconnecting", forever. */
  staleInstallSignal(): ReadableState<string | null> {
    return this.staleInstallAcc
  }

  /** Explicitly force the same spawning recovery used by a GUI socket drop. */
  async manualReconnect(): Promise<void> {
    this.client.forceDisconnect()
    await this.reconnectLoop(true)
  }

  dispose(): void {
    this.client.close()
  }

  // Reads return the same cells written by hello and channel events.

  readonly tasksSignal = (): ReadableState<Task[]> => this.tasksAcc

  readonly activeTaskSignal = (): ReadableState<string | null> => this.activeTaskAcc

  readonly updateSignal = (): ReadableState<UpdateInfo | null> => this.updateAcc

  readonly daemonVersionSignal = (): ReadableState<string | null> => this.daemonVersionAcc

  readonly daemonStaleSignal = (): ReadableState<boolean> => this.daemonStaleAcc

  /**
   * True while a daemon that announced an explicit restart has not yet come
   * back. Narrower than "disconnected" on purpose: it is only ever set by a
   * daemon SAYING it is being replaced, so it can never stand in for the
   * generic socket-drop signal the workspace deliberately does not surface.
   *
   * Its one job is to keep a refresh from stopping a daemon somebody else is
   * already mid-way through replacing (`planSelfRefresh`).
   */
  readonly daemonRestartingSignal = (): ReadableState<boolean> => this.daemonRestartingAcc

  /**
   * Ask the daemon to stop for a RESTART, then let the normal recovery path
   * bring one back. Used by the self-refresh: the daemon reloads its code
   * from disk on the way back up, which is the half of a build skew this
   * process cannot fix by relaunching itself.
   *
   * Best-effort by design — a daemon that is already gone, already stopping,
   * or too wedged to answer leaves nothing to stop, and the caller's next
   * step (relaunch, which spawns a daemon if none is reachable) covers every
   * one of those.
   */
  async restartDaemon(): Promise<void> {
    await this.client.request("daemon.stop", { reason: "restart" }).catch(() => {})
  }

  readonly engineStateSignal = (): ReadableState<ReadonlyMap<string, TaskEngineState>> => this.engineStateAcc

  /** Per-TAB engine activity (taskId → tabId → state) — the F7 attention
   *  jump's tab-precise read. Sparse; see {@link EngineTabStateMap}. */
  readonly engineTabStatesSignal = (): ReadableState<EngineTabStateMap> => this.engineTabStateAcc

  readonly attentionInboxSignal = (): ReadableState<readonly AttentionInboxItem[]> => this.attentionInboxAcc

  readonly taskJobsSignal = (): ReadableState<ReadonlyMap<string, TaskJobState>> => this.taskJobsAcc

  /** null means the daemon has not supplied this channel; readers may poll locally. */
  readonly worktreeChangesSignal = (): ReadableState<WorktreeChangesMap | null> => this.worktreeChangesAcc

  readonly usageSnapshotSignal = (): ReadableState<UsageSnapshotMap | null> => this.usageSnapshotAcc
  /** Per-session context occupancy (`usage.context`) — the footer's ctx meter. */
  readonly contextUsageSignal = (): ReadableState<ContextUsageMap | null> => this.contextUsageAcc

  readonly transcriptActivitySignal = (): ReadableState<TranscriptActivityMap | null> => this.transcriptActivityAcc

  /** Store and signal access share one cell and one subscription stream. */
  readonly transcriptActivityStore = (): ExternalStore<TranscriptActivityMap | null> => this.transcriptActivityAcc

  /** Latest daemon-broadcast notice (`notice.event`) — consumers dedupe on `at`. */
  readonly noticeStore = (): ExternalStore<NoticeEventPayload | null> => this.noticeAcc

  /** Latest `tab.open` request (plugin panes) — consumers dedupe on `at`. */
  readonly tabOpenStore = (): ExternalStore<TabOpenPayload | null> => this.tabOpenAcc

  /** Latest `tab.close` request (pane or exact Terminal Tab) — consumers dedupe on `at`. */
  readonly tabCloseStore = (): ExternalStore<TabClosePayload | null> => this.tabCloseAcc

  /** Latest `tab.rename` request (`rove api rename --tab`) — consumers dedupe on `at`. */
  readonly tabRenameStore = (): ExternalStore<TabRenamePayload | null> => this.tabRenameAcc

  /**
   * The bare request/response seam onto this orchestrator's daemon, for the
   * few callers that need a verb this class does not wrap — today the
   * quick-fork ROUND, whose siblings are delivered by `core/`'s headless
   * session starter rather than by a mounted pane.
   *
   * Deliberately narrowed to {@link DaemonRpcClient}: exposing the socket
   * client itself would hand callers `subscribe`/`close`, and a second
   * subscriber or an accidental close would take the whole UI's event stream
   * down with it.
   */
  readonly rpc: DaemonRpcClient = { request: (name, payload) => this.client.request(name, payload) }

  replyTerminalTabClose = (requestId: string, closed: boolean): void =>
    writes.replyTabCloseOp(this.client, requestId, closed)

  /** Latest `ui.prompt` request (host input dialog) — consumers dedupe on `at`. */
  readonly uiPromptStore = (): ExternalStore<UiPromptPayload | null> => this.uiPromptAcc

  /** Answer a `ui.prompt` request; omit `value` to report a cancel. */
  readonly replyPrompt = (promptId: string, value?: string): void =>
    void this.client.request("ui.promptReply", { promptId, ...(value !== undefined ? { value } : {}) }).catch(() => {})

  /** Transient per-task lifecycle marks (subagent activity). */
  readonly engineLifecycleSignal = (): ReadableState<EngineLifecycleMap> => this.engineLifecycleAcc

  /** One task's recent engine events (the event feed; newest last). */
  recentTaskEvents(id: TaskId | string): Promise<{ events: readonly RecentTaskEvent[] }> {
    return this.client.request("task.recentEvents", { taskId: String(id) })
  }

  /** Fire-and-forget UI moment → plugin event hooks (`ui.reportEvent`). */
  readonly reportUiEvent = (kind: string, taskId?: string, detail?: Record<string, unknown>): void =>
    void this.client
      .request("ui.reportEvent", { kind, ...(taskId ? { taskId } : {}), ...(detail ? { detail } : {}) })
      .catch(() => {})

  /** Confirmed ESC interrupt on a hook-running tab — see
   *  {@link reportEngineInterruptOp}. */
  readonly reportEngineInterrupt = (taskId: TaskId | string, tabId: string): void =>
    writes.reportEngineInterruptOp(this.client, String(taskId), tabId)

  readonly uiPrefsSignal = (): ReadableState<UiPrefsPayload | null> => this.uiPrefsAcc

  readonly uiPrefsStore = (): ExternalStore<UiPrefsPayload | null> => this.uiPrefsAcc

  readonly keybindingsRevSignal = (): ReadableState<number | null> => this.keybindingsRevAcc

  readonly keybindingsRevStore = (): ExternalStore<number | null> => this.keybindingsRevAcc

  readonly listTasks = (): Task[] => this.tasksAcc()

  readonly getTask = (id: TaskId | string): Task | undefined => this.tasksAcc().find((task) => task.id === id)

  subscribeTasks(listener: (snapshot: readonly Task[]) => void): Unsubscribe {
    return subscribeTasksOp(this.tasksAcc, listener)
  }

  // RPC serialization and result handling live in remote-orchestrator-writes.ts.

  createTask = (input: Parameters<typeof writes.createTaskOp>[1]): Promise<Task> =>
    writes.createTaskOp(this.client, input)
  ensureMainTask = (repo: string): Promise<Task> => writes.ensureMainTaskOp(this.client, repo)
  openDirectoryTask = (input: { dir: string; scratch?: boolean }): Promise<Task> =>
    writes.openDirectoryTaskOp(this.client, input)
  adoptScratchRepo = (id: TaskId | string, repo: string): Promise<void> =>
    writes.adoptScratchRepoOp(this.client, id, repo)
  ensureWorktree = (id: TaskId | string): Promise<string> => writes.ensureWorktreeOp(this.client, id)
  forgetProject = (repo: string): Promise<void> => writes.forgetProjectOp(this.client, repo)
  setTitle = (id: TaskId | string, title: string): Promise<void> => writes.setTitleOp(this.client, id, title)
  setBranch = (id: TaskId | string, branch: string): Promise<void> => writes.setBranchOp(this.client, id, branch)
  setVendor = (id: TaskId | string, vendor: VendorId, effort?: string): Promise<void> =>
    writes.setVendorOp(this.client, id, vendor, effort)
  setCommand = (id: TaskId | string, command: string, vendor?: VendorId): Promise<void> =>
    writes.setCommandOp(this.client, id, command, vendor)
  setPinned = (id: TaskId | string, pinned?: boolean): Promise<void> => writes.setPinnedOp(this.client, id, pinned)
  moveTask = (id: TaskId | string, delta: -1 | 1): Promise<void> => writes.moveTaskOp(this.client, id, delta)
  setStatus = (id: TaskId | string, status: TaskStatus): Promise<void> => writes.setStatusOp(this.client, id, status)
  setPrompt = (id: TaskId | string, prompt: string): Promise<void> => writes.setPromptOp(this.client, id, prompt)
  deleteTask = (id: TaskId | string, opts?: { force?: boolean; deleteBranch?: boolean }): Promise<void> =>
    writes.deleteTaskOp(this.client, id, opts)
  dismissAttention = (taskId: TaskId | string, tabId: string | null, at: number): Promise<boolean> =>
    writes.dismissAttentionOp(this.client, taskId, tabId, at)
  dismissRoutineAttention = (automationId: string): Promise<boolean> =>
    writes.dismissRoutineAttentionOp(this.client, automationId)
  markAttentionRead = (taskId: TaskId | string, tabId: string | null, at: number): Promise<boolean> =>
    writes.markAttentionReadOp(this.client, taskId, tabId, at)

  /** Land a task's branch back into its base repo (`task.land`). Throws with a
   *  `LAND_CONFLICT` / `MAIN_CHECKOUT_DIRTY` sentinel in the message on the
   *  guarded failures so callers can print the conflicted files / re-prompt. */
  /** Read-only land probe (`task.landPreflight`) — destination, commit count,
   *  refusal. Never writes; behind the land confirm's copy. */
  landPreflight(id: TaskId | string): ReturnType<typeof writes.landPreflightOp> {
    return writes.landPreflightOp(this.client, id)
  }

  landTask(id: TaskId | string, opts?: Parameters<typeof writes.landTaskOp>[2]): ReturnType<typeof writes.landTaskOp> {
    return writes.landTaskOp(this.client, id, opts)
  }

  discoverAdoptableWorktrees(repo: string): Promise<readonly AdoptableWorktree[]> {
    return writes.discoverAdoptableWorktreesOp(this.client, repo)
  }

  adoptWorktree(input: Parameters<typeof writes.adoptWorktreeOp>[1]): Promise<Task> {
    return writes.adoptWorktreeOp(this.client, input)
  }

  /** Every worktree of every local saved project — the standalone
   *  worktree-management TUI page (`worktree.list`). `network: false` =
   *  local-signals-only fast pass. */
  listWorktrees(opts?: { network?: boolean }): Promise<readonly WorktreeProject[]> {
    return writes.listWorktreesOp(this.client, opts)
  }

  /** A repo's daemon-owned issues (`issue.list`) — the kanban page's read. */
  listIssues(repoRoot: string): Promise<RepoIssues> {
    return writes.listIssuesOp(this.client, repoRoot)
  }

  /** Repo roots the issue store knows (`issue.repos`) — the kanban page's
   *  board source, see {@link writes.listIssueReposOp}. */
  listIssueRepos(): Promise<readonly string[]> {
    return writes.listIssueReposOp(this.client)
  }

  /** One issue-store mutation (`issue.mutate`) — the kanban detail drawer's
   *  write path (link on start, setStatus for the project placement). */
  mutateIssue(repoRoot: string, op: unknown): Promise<RepoIssues> {
    return writes.mutateIssueOp(this.client, repoRoot, op)
  }

  // Automations, work items and field notes.
  listAutomations = () => writes.listAutomationsOp(this.client)
  createAutomation = (i: Parameters<typeof writes.createAutomationOp>[1]) => writes.createAutomationOp(this.client, i)
  automationRuns = (id: string) => writes.automationRunsOp(this.client, id)
  setAutomationEnabled = (id: string, on: boolean) => writes.setAutomationEnabledOp(this.client, id, on)
  runAutomationNow = (id: string) => writes.runAutomationNowOp(this.client, id)
  deleteAutomation = (id: string) => writes.deleteAutomationOp(this.client, id)
  listWorkItems = (a: Parameters<typeof writes.listWorkItemsOp>[1]) => writes.listWorkItemsOp(this.client, a)
  listFieldNotes = (repo: string) => writes.listFieldNotesOp(this.client, repo)

  deleteFieldNote = (repo: string, id: number) => writes.deleteFieldNoteOp(this.client, repo, id)
  /** A PR's failing checks + log tails (`pr.failingChecks`). On demand only. */
  failingChecks = (taskId: string) => writes.failingChecksOp(this.client, taskId)
  /** Merge a task's base branch into its worktree (`task.syncBase`). */
  syncBase = (taskId: string) => writes.syncBaseOp(this.client, taskId)
  startWorkItem = (a: Parameters<typeof writes.startWorkItemOp>[1]) => writes.startWorkItemOp(this.client, a)

  /** Remove a worktree (`worktree.remove`); refuses a dirty one unless
   *  `force` is true — same safety property `GitWorktreeManager.remove`
   *  always had. */
  removeWorktree(path: string, force?: boolean): Promise<WorktreeResidue | null> {
    return writes.removeWorktreeOp(this.client, path, force)
  }

  /**
   * Mark a task as the active focus (the session just switched/entered).
   * The daemon publishes it on the `active-task` channel so every Tasks
   * pane + the outer monitor highlight the same task.
   */
  setActiveTask(id: TaskId | string | null): Promise<void> {
    return writes.setActiveTaskOp(this.client, id)
  }
}
