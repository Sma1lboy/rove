/** React subscriptions to the workspace host's daemon signals.
 *
 * Its own hook because this block is pure plumbing with no decisions in it:
 * one `useAccessor` per signal. Grouping them keeps the orchestration layer
 * from being buried under ten signal reads before it wires any behavior. The
 * rows' status glyphs read the daemon's row status (`row-status-sync.ts`),
 * not these. */

import type { RowTokenMap } from "@/client/remote-orchestrator"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import type {
  AttentionInboxItem,
  EngineLifecycleMap,
  EngineTabStateMap,
  TaskEngineState,
  TaskJobState,
  WorktreeChangesMap,
} from "../../client/remote-orchestrator-payloads"
import { useMergedTasks } from "../../machines/hub-singleton"
import type { Task } from "../../types/task"
import { useAccessor } from "../lib/use-accessor"

export interface UseDaemonStateResult {
  tasks: readonly Task[]
  activeTaskId: string | null
  engineState: ReadonlyMap<string, TaskEngineState>
  engineLifecycle: EngineLifecycleMap
  engineTabState: EngineTabStateMap
  inboxItems: readonly AttentionInboxItem[]
  taskJobs: ReadonlyMap<string, TaskJobState>
  rowTokens: RowTokenMap
  worktreeChanges: WorktreeChangesMap | null
}

export function useDaemonState(orchestrator: RemoteOrchestrator): UseDaemonStateResult {
  // Machines-aware: the merged list when any machine is registered, the
  // orchestrator's own cell otherwise (`hub-singleton.ts`).
  const tasks = useMergedTasks(orchestrator)
  const activeTaskId = useAccessor(orchestrator.activeTaskSignal())
  const engineState = useAccessor(orchestrator.engineStateSignal())
  const engineLifecycle = useAccessor(orchestrator.engineLifecycleSignal())
  const engineTabState = useAccessor(orchestrator.engineTabStatesSignal())
  const inboxItems = useAccessor(orchestrator.attentionInboxSignal())
  const taskJobs = useAccessor(orchestrator.taskJobsSignal())
  const rowTokens = useAccessor(orchestrator.rowTokensSignal())
  const worktreeChanges = useAccessor(orchestrator.worktreeChangesSignal())

  return {
    tasks,
    activeTaskId,
    engineState,
    engineLifecycle,
    engineTabState,
    inboxItems,
    taskJobs,
    rowTokens,
    worktreeChanges,
  }
}
