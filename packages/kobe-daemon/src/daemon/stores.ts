/** Constructs every daemon-owned store plus the per-task teardown chain. */

import { readActivityLiveness } from "./activity-liveness.ts"
import { type ActivityLivenessProbe, DaemonActivityRegistry } from "./activity-registry.ts"
import { AgentTurnsStore, defaultAgentTurnsPath } from "./agent-turns-store.ts"
import { AttentionInboxStore, defaultAttentionInboxPath } from "./attention-inbox.ts"
import { initAutomationsStore } from "./automation-wiring.ts"
import type { AutomationsStore } from "./automations-store.ts"
import type { DaemonOrchestrator } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import { EngineEventLog } from "./engine-events-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import { IssuesStore, defaultIssuesStorePath } from "./issues-store.ts"
import { NotesStore, defaultNotesStorePath } from "./notes-store.ts"
import { QuotaUsageCache } from "./quota-usage-cache.ts"
import { RowTokenStore } from "./row-tokens.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { TaskDeletionRunner } from "./task-deletion-runner.ts"
import { WorkItemCache } from "./work-items.ts"

/** Every daemon-owned store + the teardown runner, created in one place. */
export interface DaemonStores {
  readonly activity: DaemonActivityRegistry
  readonly inbox: AttentionInboxStore
  readonly agentTurns: AgentTurnsStore
  readonly deletions: TaskDeletionRunner
  readonly issues: IssuesStore
  readonly notes: NotesStore
  readonly automations: AutomationsStore
  readonly workItems: WorkItemCache
  readonly quotaUsage: QuotaUsageCache
  readonly engineEvents: EngineEventLog
  readonly rowTokens: RowTokenStore
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
  const agentTurns = new AgentTurnsStore(defaultAgentTurnsPath(homeDir))
  await agentTurns.init().catch((err) => logDaemonError("agent-turns-init", err))
  // In memory on purpose: restoring a token whose author is gone is the stale
  // state its TTL exists to prevent.
  const rowTokens = new RowTokenStore(bus)
  const clearTaskState = (taskId: string) =>
    inbox
      .deleteTaskBestEffort(taskId)
      .finally(() => agentTurns.deleteTask(taskId).catch((err) => logDaemonError("agent-turns-delete", err)))
      .finally(() => activity.clearTask(taskId))
      // Else the map keeps republishing tokens for a row nothing renders.
      .finally(() => rowTokens.clearTask(taskId))
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
    inbox,
    agentTurns,
    deletions,
    issues,
    notes,
    automations,
    workItems,
    quotaUsage,
    engineEvents,
    rowTokens,
  }
}
