/**
 * Daemon-owned durable store wiring — split out of `server.ts` (which was at
 * the ~500-line cap) by responsibility: this module owns CREATING every
 * daemon-owned store plus the per-task teardown chain, so the composition root
 * only destructures the bag. Behavior is unchanged; the split is layout only.
 */

import { readActivityLiveness } from "./activity-liveness.ts"
import { type ActivityLivenessProbe, DaemonActivityRegistry } from "./activity-registry.ts"
import { AgentTurnsStore, defaultAgentTurnsPath } from "./agent-turns-store.ts"
import { AttentionInboxStore, defaultAttentionInboxPath } from "./attention-inbox.ts"
import { initAutomationsStore } from "./automation-wiring.ts"
import type { AutomationsStore } from "./automations-store.ts"
import type { DaemonOrchestrator } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import { DeferredPromptsStore, defaultDeferredPromptsPath } from "./deferred-prompts-store.ts"
import { EngineEventLog } from "./engine-events-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import { IssuesStore, defaultIssuesStorePath } from "./issues-store.ts"
import { NotesStore, defaultNotesStorePath } from "./notes-store.ts"
import { QuotaUsageCache } from "./quota-usage-cache.ts"
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
  readonly deferredPrompts: DeferredPromptsStore
  readonly automations: AutomationsStore
  readonly workItems: WorkItemCache
  readonly quotaUsage: QuotaUsageCache
  readonly engineEvents: EngineEventLog
}

/**
 * Create + init the durable stores and the per-task teardown runner. `homeDir`
 * is the UNRESOLVED `options.homeDir` — the store path helpers resolve it, and
 * matching the previous inline wiring exactly keeps sandbox isolation identical.
 */
export async function initDaemonStores(
  orch: DaemonOrchestrator,
  runtime: DaemonRuntimeAdapter,
  bus: DaemonEventBus,
  homeDir: string | undefined,
): Promise<DaemonStores> {
  // Liveness probe for the activity lapse watchdog — see activity-liveness.ts
  // for why it reads a completion marker and not just the transcript mtime.
  const livenessAt: ActivityLivenessProbe = (taskId, vendor, transcriptPath) =>
    readActivityLiveness(orch, runtime, taskId, vendor, transcriptPath)
  const activity = new DaemonActivityRegistry(bus, undefined, undefined, livenessAt)
  const inbox = new AttentionInboxStore(defaultAttentionInboxPath(homeDir), bus)
  await inbox.init().catch((err) => logDaemonError("attention-inbox-init", err))
  // Durable per-turn telemetry (issue #32) — written by the `turn-complete`
  // hook ingest, read by `agentTurn.list`. Same homeDir isolation as the
  // other daemon-owned stores so a sandbox home never writes to the real one.
  const agentTurns = new AgentTurnsStore(defaultAgentTurnsPath(homeDir))
  await agentTurns.init().catch((err) => logDaemonError("agent-turns-init", err))
  // Deferred prompts (issue #78 B-layer) — the delivery gate hands blocked
  // prompts to daemon ownership; same homeDir isolation as the other stores.
  const deferredPrompts = new DeferredPromptsStore(defaultDeferredPromptsPath(homeDir))
  const clearTaskState = (taskId: string) =>
    inbox
      .deleteTaskBestEffort(taskId)
      .finally(() => agentTurns.deleteTask(taskId).catch((err) => logDaemonError("agent-turns-delete", err)))
      .finally(() => deferredPrompts.deleteTask(taskId).catch((err) => logDaemonError("deferred-prompts-delete", err)))
      .finally(() => activity.clearTask(taskId))
  const deletions = new TaskDeletionRunner(orch, runtime, clearTaskState)
  // Daemon-owned issue tracker (web Issues panel) — a single store keyed by
  // git common-dir, sharing the server's homeDir so sandbox/test homes
  // isolate. Handlers reach it through DaemonHandlerContext.issues.
  const issues = new IssuesStore(defaultIssuesStorePath(homeDir))
  // Durable field notes (docs/design/dispatcher.md) — same key convention and
  // homeDir isolation as the issue store. Written by `note.file`, read back at
  // worktree launch so a fresh session starts with the repo's known gotchas.
  const notes = new NotesStore(defaultNotesStorePath(homeDir))
  // Daemon-owned scheduled automations. The sweep that fires them is started
  // with the other collectors; this only loads the persisted schedules.
  const automations = await initAutomationsStore(homeDir)
  // Read-only external tracker view; in-memory only (see work-items.ts).
  const workItems = new WorkItemCache()
  // Sole caller of the engine quota probes — owns the fetch cadence (the
  // vendor usage APIs are themselves rate-limited). Shared by the usage
  // poller (collectors) and the rate-limit resume scheduler (handlers).
  const quotaUsage = new QuotaUsageCache(runtime, bus)
  // Per-task recent engine events (the TUI event feed / task.recentEvents).
  const engineEvents = new EngineEventLog()
  return {
    activity,
    inbox,
    agentTurns,
    deletions,
    issues,
    notes,
    deferredPrompts,
    automations,
    workItems,
    quotaUsage,
    engineEvents,
  }
}
