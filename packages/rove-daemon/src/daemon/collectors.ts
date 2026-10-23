/**
 * Wires the daemon's background collectors/watchers so server.ts only decides
 * WHEN they run; each collector's mechanics live in its own module.
 */

import { programStatusActivity } from "./program-status-activity"
import { watchProgramStatus } from "./program-status-watch"

import type { DaemonRpcClient } from "../client/rpc.ts"
import { createActivityObserverIo } from "./activity-observer-io.ts"
import { startActivityObserver } from "./activity-observer.ts"
import type { DaemonActivityRegistry } from "./activity-registry.ts"
import { DEFAULT_AUTO_TITLE_POLL_MS, startAutoTitlePoller } from "./auto-title-poller.ts"
import type { DispatchRunnability } from "./automation-dispatch.ts"
import { DEFAULT_AUTOMATION_TICK_MS, startAutomationRunner } from "./automation-runner.ts"
import type { AutomationsStore } from "./automations-store.ts"
import type { ChannelName } from "./channels.ts"
import { DEFAULT_CONTEXT_USAGE_TICK_MS, startContextUsageCollector } from "./context-usage-collector.ts"
import type { DaemonOrchestrator, UpdateInfo } from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import { resolvePtyOwner } from "./cwd-task.ts"
import { type DeliveryDeps, sweepStalledDeliveries } from "./delivery-ops.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import {
  DEFAULT_KEYBINDINGS_DEBOUNCE_MS,
  defaultKeybindingsPath,
  startKeybindingsWatcher,
} from "./keybindings-watcher.ts"
import { DEFAULT_PR_STATUS_POLL_MS, startPrStatusPoller } from "./pr-status-collector.ts"
import type { PtyOwnerResolver } from "./pty-exit-watch.ts"
import { DEFAULT_QUOTA_RESUME_TICK_MS, startQuotaResumeRunner } from "./quota-resume.ts"
import { type QuotaUsageCache, startQuotaUsagePoller } from "./quota-usage-cache.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { DEFAULT_STATE_DEBOUNCE_MS, startStateWatcher } from "./state-watcher.ts"
import { startTicker } from "./ticker.ts"
import {
  DEFAULT_TRANSCRIPT_ACTIVITY_TICK_MS,
  startTranscriptActivityCollector,
} from "./transcript-activity-collector.ts"
import { DEFAULT_UI_PREFS_DEBOUNCE_MS, defaultUiPrefsStatePath, startUiPrefsWatcher } from "./ui-prefs-watcher.ts"
import { DEFAULT_WORKTREE_CHANGES_TICK_MS, startWorktreeChangesCollector } from "./worktree-changes-collector.ts"

/** npm re-check cadence; `latest` rarely moves. */
const DEFAULT_UPDATE_POLL_MS = 6 * 60 * 60 * 1000

/** The interval/debounce knobs of `DaemonServerOptions` the collectors read. */
export interface DaemonCollectorOptions {
  readonly homeDir?: string
  readonly checkUpdate?: () => Promise<UpdateInfo | null>
  readonly updatePollMs?: number
  readonly autoTitlePollMs?: number
  readonly prStatusPollMs?: number
  readonly uiPrefsDebounceMs?: number
  readonly keybindingsDebounceMs?: number
  readonly worktreeChangesTickMs?: number
  readonly transcriptActivityTickMs?: number
  readonly contextUsageTickMs?: number
  readonly quotaResumeTickMs?: number
  readonly quotaUsageTickMs?: number
  readonly automationTickMs?: number
  /** Whose a hosted PTY is (default: the child aliased to it, else the key's task); the server adds released aliases. */
  readonly ownerOf?: PtyOwnerResolver
}

/** What the automation sweep needs; omitted in tests that don't exercise it. */
export interface AutomationCollectorDeps {
  readonly store: AutomationsStore
  /** Deliveries every armed prompt reports into; also the stall sweep's input. */
  readonly deliveryDeps: DeliveryDeps
  readonly link: DaemonRpcClient | (() => DaemonRpcClient)
  /** Plugin host getter (constructed after the collectors start, like `link`). */
  readonly plugins?: () => import("../plugins/runtime.ts").PluginHost | null
  readonly inbox?: import("./automation-runner.ts").RunnerInbox
  /** Answered decision gates owed to a routine's target tab ride its next firing. */
  readonly gates?: import("./gate-handoff.ts").GateLedger
  /** Should-run for the routine runner and quota-resume. */
  readonly runnability?: DispatchRunnability
  readonly dispatches?: import("./automation-runner.ts").RunnerDeps["dispatches"]
}

/**
 * Tier-(b) protocol sniff: upgrades a GENERIC task record from its live
 * session. Only `tab-1`, launched from the task's own command, may speak for
 * the record; other tabs may run a hand-started or different vendor. Naming +
 * eligibility are engine-owned (`runtime.resolveProtocolUpgrade`, absent →
 * never upgrades). The observer drains the returned write before shutdown.
 * Activity claims are untouched: a sniff names an engine, it doesn't resurrect
 * a dot. Idempotent: an upgraded record is no longer generic.
 */
export function createProtocolUpgradeReporter(
  orch: Pick<DaemonOrchestrator, "getTask" | "setCommand">,
  runtime: Pick<DaemonRuntimeAdapter, "resolveProtocolUpgrade">,
): (
  taskId: string,
  tabId: string,
  evidence: { readonly walkVendor: string | null; readonly title: string },
) => void | Promise<void> {
  return (taskId, tabId, evidence) => {
    if (tabId !== "tab-1") return
    const task = orch.getTask(taskId)
    if (!task) return
    const upgrade = runtime.resolveProtocolUpgrade?.(task, evidence)
    if (!upgrade) return
    return orch
      .setCommand(taskId, upgrade.command, upgrade.vendor)
      .then(() =>
        logDaemonInfo(
          "protocol-sniff",
          `upgraded task ${taskId} to the ${upgrade.vendor} protocol from its live session`,
        ),
      )
      .catch((err) => logDaemonError("protocol-sniff", err))
  }
}

const MACHINE_HUB_GATE_MS = 1_000
/** Grace before a hub nobody reads lets its machines go: a TUI restarting must not flap every connection. */
const MACHINE_HUB_IDLE_MS = 15_000

/**
 * Run the machine hub only while some client reads `machines`. A peer's hub
 * subscribes here without it (`PEER_CHANNELS` in rove `machines/hub.ts`), so
 * two machines registered to each other never keep each other's hubs up.
 */
function gateMachineHub(
  start: NonNullable<DaemonRuntimeAdapter["startMachineHub"]>,
  bus: DaemonEventBus,
  hasSubscribersFor: (channel: ChannelName) => boolean,
): () => void {
  let stop: (() => void) | null = null
  let idleSince: number | null = null
  const tick = (): void => {
    try {
      if (hasSubscribersFor("machines")) {
        idleSince = null
        stop ??= start(bus)
      } else if (stop) {
        idleSince ??= Date.now()
        if (Date.now() - idleSince >= MACHINE_HUB_IDLE_MS) {
          stop()
          stop = null
        }
      }
    } catch (err) {
      logDaemonError("machine-hub", err)
    }
  }
  tick()
  const timer = setInterval(tick, MACHINE_HUB_GATE_MS)
  timer.unref?.()
  return () => {
    clearInterval(timer)
    stop?.()
  }
}

/**
 * Start every daemon-owned collector; returns one `stop()`. Each is gated on
 * the channel it PUBLISHES, so a client subscribed only to
 * `["ui-prefs", "keybindings"]` never starts the git/gh pollers. An
 * unfiltered subscriber (every real GUI) opens all of them.
 *
 *   - update poll: npm on start + interval → `update`, so panes don't hit the
 *     registry themselves. Failures logged, not fatal.
 *   - auto-title: renames placeholder tasks from the transcript WHILE attached
 *     (tui/direct.ts only renames on detach); broadcasts via `task.snapshot`.
 *   - ui-prefs watcher: theme / transparent / focus-accent keys in `state.json`
 *     → `ui-prefs`, applied live in every task session. Path follows the
 *     server's homeDir, so sandbox/test homes isolate.
 *   - keybindings watcher: `~/.rove/settings/keybindings.yaml` → ping
 *     `keybindings`; panes re-read the file.
 *   - worktree-changes: guarded `git status` per local worktree →
 *     `worktree.changes`, instead of per-row polls in each pane.
 *   - transcript-activity: guarded fs probes (newest transcript mtime +
 *     engine-owned completion marker) → `transcript.activity`; quiescence
 *     stays in-process (the daemon never touches front-end state).
 *   - pr-status: `gh pr list --head` per task with a real branch → Task.prStatus,
 *     which rides the task push.
 */
export function startDaemonCollectors(
  orch: DaemonOrchestrator,
  runtime: DaemonRuntimeAdapter,
  bus: DaemonEventBus,
  hasSubscribersFor: (channel: ChannelName) => boolean,
  options: DaemonCollectorOptions,
  quotaUsage?: QuotaUsageCache,
  automations?: AutomationCollectorDeps,
  /** Enables the activity observer (PTY heartbeat, foreground-walk
   *  reconciler, restart seeding). Always passed by the real server. */
  activity?: DaemonActivityRegistry,
  inbox?: Pick<import("./attention-inbox").AttentionInboxStore, "record" | "deleteEpisode">,
): () => Promise<void> {
  // A migrated child owns the PTY keyed under its parent: its observed activity, program status and
  // death records are the child's, as its hook events already are.
  const ownerOf: PtyOwnerResolver =
    options.ownerOf ?? ((taskId, tabId) => resolvePtyOwner(orch.listTasks(), taskId, tabId))
  const receiveStatus = activity
    ? programStatusActivity(activity, (id) => !!orch.getTask(id), inbox, automations?.deliveryDeps, ownerOf)
    : undefined
  const stopStatusWatch = receiveStatus
    ? watchProgramStatus(receiveStatus, { homeDir: options.homeDir })
    : async () => {}
  // First tick immediately (restart seeding), then the slow poll.
  const stopActivityObserver = activity
    ? startActivityObserver(
        activity,
        {
          ...createActivityObserverIo(options.homeDir, runtime, activity, ownerOf),
          onEngineEvidence: createProtocolUpgradeReporter(orch, runtime),
          onProgramStatusEvent: receiveStatus,
        },
        () => hasSubscribersFor("engine-state"),
        { ownerOf },
      )
    : () => {}
  const checkUpdate = options.checkUpdate ?? runtime.checkLatestVersion
  const updatePollMs = options.updatePollMs ?? DEFAULT_UPDATE_POLL_MS
  const pollUpdate = (): void => {
    void checkUpdate()
      .then((info) => bus.publish("update", { info }))
      .catch((err) => logDaemonError("update-poller", err))
  }
  let updateTimer: ReturnType<typeof setInterval> | null = null
  if (updatePollMs > 0) {
    pollUpdate()
    updateTimer = setInterval(pollUpdate, updatePollMs)
    updateTimer.unref?.()
  }

  const stopAutoTitlePoller = startAutoTitlePoller(
    orch,
    runtime,
    options.autoTitlePollMs ?? DEFAULT_AUTO_TITLE_POLL_MS,
    // A rename rides the task push, so the consumer to gate on is task.snapshot.
    () => hasSubscribersFor("task.snapshot"),
  )

  const stopUiPrefsWatcher = startUiPrefsWatcher(bus, {
    statePath: defaultUiPrefsStatePath(options.homeDir),
    debounceMs: options.uiPrefsDebounceMs ?? DEFAULT_UI_PREFS_DEBOUNCE_MS,
  })

  const stopStateWatcher = startStateWatcher(
    bus,
    defaultUiPrefsStatePath(options.homeDir),
    options.uiPrefsDebounceMs ?? DEFAULT_STATE_DEBOUNCE_MS,
  )

  const stopMachineHub = runtime.startMachineHub
    ? gateMachineHub(runtime.startMachineHub, bus, hasSubscribersFor)
    : () => {}

  const stopKeybindingsWatcher = startKeybindingsWatcher(bus, {
    path: defaultKeybindingsPath(options.homeDir),
    debounceMs: options.keybindingsDebounceMs ?? DEFAULT_KEYBINDINGS_DEBOUNCE_MS,
  })

  const stopWorktreeChangesCollector = startWorktreeChangesCollector(
    orch,
    runtime,
    bus,
    options.worktreeChangesTickMs ?? DEFAULT_WORKTREE_CHANGES_TICK_MS,
    () => hasSubscribersFor("worktree.changes"),
    // Working engines keep the fast cadence: the quiet-backoff change probe
    // is blind to nested writes, which is what they produce.
    activity ? () => activity.workingTaskIds() : undefined,
  )

  const stopTranscriptActivityCollector = startTranscriptActivityCollector(
    orch,
    runtime,
    bus,
    options.transcriptActivityTickMs ?? DEFAULT_TRANSCRIPT_ACTIVITY_TICK_MS,
    () => hasSubscribersFor("transcript.activity"),
  )

  // Footer `ctx N%` per live session; the activity registry knows which tabs
  // have one.
  const stopContextUsageCollector = activity
    ? startContextUsageCollector(
        activity,
        orch,
        bus,
        runtime,
        options.contextUsageTickMs ?? DEFAULT_CONTEXT_USAGE_TICK_MS,
        () => hasSubscribersFor("usage.context"),
      )
    : () => {}

  // Gate also opens on a live engine: unattended agents need CI truth (see
  // startPrStatusPoller).
  const stopPrStatusPoller = startPrStatusPoller(
    orch,
    runtime,
    options.prStatusPollMs ?? DEFAULT_PR_STATUS_POLL_MS,
    // prStatus rides the task push too.
    () => hasSubscribersFor("task.snapshot"),
    undefined,
    activity ? () => activity.workingTaskIds().length > 0 : undefined,
  )

  // Ungated: its job is resuming rate-limited engines while nobody is attached.
  const stopQuotaResumeRunner = startQuotaResumeRunner(
    orch,
    runtime,
    options.quotaResumeTickMs ?? DEFAULT_QUOTA_RESUME_TICK_MS,
    undefined,
    automations?.plugins,
    automations?.runnability,
  )

  // Ungated: a schedule that requires an audience is not a schedule.
  const stopAutomationRunner = automations
    ? startAutomationRunner(
        {
          store: automations.store,
          deliveries: automations.deliveryDeps.deliveries,
          orch,
          runtime,
          link: automations.link,
          ...(automations.plugins ? { plugins: automations.plugins } : {}),
          ...(automations.inbox ? { inbox: automations.inbox } : {}),
          ...(automations.gates ? { gates: automations.gates } : {}),
          ...(automations.runnability ? { runnability: automations.runnability } : {}),
          ...(automations.dispatches ? { dispatches: automations.dispatches } : {}),
        },
        options.automationTickMs ?? DEFAULT_AUTOMATION_TICK_MS,
      )
    : () => {}

  // Same cadence and ungated like the schedule sweep: the backstop for an
  // armed delivery whose engine never signalled a stop.
  const deliverySweepBootedAt = (automations?.deliveryDeps.now ?? Date.now)()
  const stopDeliverySweep =
    automations && activity
      ? startTicker({
          name: "delivery-sweep",
          tickMs: options.automationTickMs ?? DEFAULT_AUTOMATION_TICK_MS,
          run: () => sweepStalledDeliveries(automations.deliveryDeps, activity, deliverySweepBootedAt),
        })
      : () => {}

  // Gated; the resume scheduler reads the cache on demand. Polls every vendor
  // with a probe, not just ones in use: a balance belongs to the account.
  // Cadence lives entirely in the cache.
  const stopQuotaUsagePoller = quotaUsage
    ? startQuotaUsagePoller(
        quotaUsage,
        () => runtime.vendorsWithQuotaProbe(),
        () => hasSubscribersFor("usage.snapshot"),
        options.quotaUsageTickMs,
      )
    : () => {}

  return async () => {
    if (updateTimer) clearInterval(updateTimer)
    await Promise.allSettled(
      [
        stopActivityObserver,
        stopStatusWatch,
        stopAutoTitlePoller,
        stopPrStatusPoller,
        stopQuotaResumeRunner,
        stopAutomationRunner,
        stopDeliverySweep,
        stopQuotaUsagePoller,
        stopUiPrefsWatcher,
        stopStateWatcher,
        stopMachineHub,
        stopKeybindingsWatcher,
        stopWorktreeChangesCollector,
        stopTranscriptActivityCollector,
        stopContextUsageCollector,
      ].map(async (stop) => stop()),
    )
  }
}
