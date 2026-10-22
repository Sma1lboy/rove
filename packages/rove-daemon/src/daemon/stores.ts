/** Constructs every daemon-owned store plus the per-task teardown chain. */

import { readActivityLiveness } from "./activity-liveness.ts"
import { type ActivityLivenessProbe, DaemonActivityRegistry } from "./activity-registry.ts"
import { AgentTurnsStore, defaultAgentTurnsPath } from "./agent-turns-store.ts"
import { AttentionInboxStore, defaultAttentionInboxPath } from "./attention-inbox.ts"
import { initAutomationsStore } from "./automation-wiring.ts"
import type { AutomationsStore } from "./automations-store.ts"
import type { DaemonOrchestrator } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import { DeliveriesStore } from "./deliveries-store.ts"
import { EngineEventLog } from "./engine-events-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import { GatesStore, defaultGatesStorePath } from "./gates-store.ts"
import { IssuesStore, defaultIssuesStorePath } from "./issues-store.ts"
import { NotesStore, defaultNotesStorePath } from "./notes-store.ts"
import { defaultDeliveriesPath } from "./paths.ts"
import { QuotaUsageCache } from "./quota-usage-cache.ts"
import { RowTokenStore } from "./row-tokens.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { TabsStore } from "./tabs-store.ts"
import { TaskDeletionRunner } from "./task-deletion-runner.ts"
import { WorkItemCache } from "./work-items.ts"

/** Every daemon-owned store + the teardown runner, created in one place. */
export interface DaemonStores {
  readonly gates: GatesStore
  readonly activity: DaemonActivityRegistry
  readonly inbox: AttentionInboxStore
  readonly agentTurns: AgentTurnsStore
  readonly deletions: TaskDeletionRunner
  readonly issues: IssuesStore
  readonly notes: NotesStore
  readonly automations: AutomationsStore
  readonly deliveries: DeliveriesStore
  readonly workItems: WorkItemCache
  readonly quotaUsage: QuotaUsageCache
  readonly engineEvents: EngineEventLog
  readonly rowTokens: RowTokenStore
  readonly tabs: TabsStore
}

/**
 * Create + init the durable stores and the per-task teardown runner. `homeDir`
 * is the UNRESOLVED `options.homeDir` — the store path helpers resolve it, and
 * resolving anywhere else breaks sandbox isolation.
 */
export async function initDaemonStores(
  orch: DaemonOrchestrator,
  runtime: DaemonRuntimeAdapter,
  bus: DaemonEventBus,
  homeDir: string | undefined,
): Promise<DaemonStores> {
  // Lapse-watchdog probe; see activity-liveness.ts for why not just mtime.
  const livenessAt: ActivityLivenessProbe = (taskId, vendor, transcriptPath) =>
    readActivityLiveness(orch, runtime, taskId, vendor, transcriptPath)
  const activity = new DaemonActivityRegistry(
    bus,
    undefined,
    undefined,
    livenessAt,
    (taskId) => orch.getTask(taskId) !== undefined,
  )
  const inbox = new AttentionInboxStore(defaultAttentionInboxPath(homeDir), bus)
  await inbox.init().catch((err) => logDaemonError("attention-inbox-init", err))
  const gates = new GatesStore(defaultGatesStorePath(homeDir))
  // Gate rows ride the Inbox as a projection; any gate change republishes both.
  inbox.setProjection(() => gates.inboxItems())
  gates.setOnChange(() => {
    bus.publish("gates", { gates: gates.active() })
    inbox.publish()
  })
  await gates.init().catch((err) => logDaemonError("gates-init", err))
  const agentTurns = new AgentTurnsStore(defaultAgentTurnsPath(homeDir))
  await agentTurns.init().catch((err) => logDaemonError("agent-turns-init", err))
  const deliveries = new DeliveriesStore(defaultDeliveriesPath(homeDir))
  await deliveries.init().catch((err) => logDaemonError("deliveries-init", err))
  // In memory on purpose: restoring a token whose author is gone is the stale
  // state its TTL exists to prevent.
  const rowTokens = new RowTokenStore(bus)
  // Sole writer of every task's terminal tabs; clients send it operations.
  const tabs = new TabsStore(runtime.tabsPersistence, bus)
  tabs.init()
  tabs.sweep((taskId) => orch.getTask(taskId) !== undefined, orch.listTasks().length > 0)
  const clearTaskState = (taskId: string) =>
    gates
      .withdrawTask(taskId)
      .catch((err) => logDaemonError("gates-withdraw-task", err))
      .then(() => inbox.deleteTaskBestEffort(taskId))
      .finally(() => deliveries.deleteTaskBestEffort(taskId))
      .finally(() => agentTurns.deleteTask(taskId).catch((err) => logDaemonError("agent-turns-delete", err)))
      .finally(() => activity.clearTask(taskId))
      // Else the map keeps republishing tokens for a row nothing renders.
      .finally(() => rowTokens.clearTask(taskId))
      .finally(() => tabs.forget(taskId))
  const deletions = new TaskDeletionRunner(orch, runtime, clearTaskState, bus)
  // Keyed by git common-dir.
  const issues = new IssuesStore(defaultIssuesStorePath(homeDir))
  // Read back at worktree launch so a fresh session gets the repo's gotchas.
  const notes = new NotesStore(defaultNotesStorePath(homeDir))
  // Loads persisted schedules only; the firing sweep starts with the collectors.
  const automations = await initAutomationsStore(homeDir)
  const workItems = new WorkItemCache()
  // Sole caller of the (rate-limited) vendor quota probes.
  const quotaUsage = new QuotaUsageCache(runtime, bus)
  const engineEvents = new EngineEventLog()
  return {
    activity,
    gates,
    inbox,
    agentTurns,
    deletions,
    issues,
    notes,
    automations,
    deliveries,
    workItems,
    quotaUsage,
    engineEvents,
    rowTokens,
    tabs,
  }
}
