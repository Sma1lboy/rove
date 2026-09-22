/**
 * Hook report → {@link AgentTurnsStore}, on `turn-complete` (records are on
 * disk). Fire-and-forget: the hook RPC must not wait on a transcript read, and
 * telemetry failures never reach the engine. `readEngineTurns` keeps the
 * daemon vendor-blind.
 */

import type { AgentTurnsStore } from "./agent-turns-store.ts"
import type { AgentTurnRecord, DaemonOrchestrator, VendorId } from "./contracts.ts"
import { logDaemonError } from "./crash-log.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"

export interface TurnIngestInput {
  readonly taskId: string
  readonly tabId?: string
  /** The `--engine` tag the hook carried; falls back to the task's vendor. */
  readonly vendor?: string
  /** The engine's own transcript, from its hook payload. No path = nothing to read. */
  readonly transcriptPath?: string
}

/** The turn that just finished — the newest record of an ingest pass. */
export type LatestTurn = Pick<AgentTurnRecord, "id" | "model" | "usage" | "startedAt" | "endedAt"> | undefined

/** `recorded` is NEW turns only — usually 0, since every read starts at the top of the file. */
export async function ingestAgentTurns(
  store: AgentTurnsStore,
  runtime: DaemonRuntimeAdapter,
  orch: DaemonOrchestrator,
  input: TurnIngestInput,
): Promise<{ recorded: number; latest: LatestTurn }> {
  if (!input.transcriptPath) return { recorded: 0, latest: undefined }
  const task = orch.getTask(input.taskId)
  const vendor = (input.vendor ?? task?.vendor) as VendorId | undefined
  if (!vendor) return { recorded: 0, latest: undefined }
  const turns = await runtime.readEngineTurns(vendor, input.transcriptPath)
  if (turns.length === 0) return { recorded: 0, latest: undefined }
  const records: AgentTurnRecord[] = turns.map((turn) => ({
    ...turn,
    taskId: input.taskId,
    ...(input.tabId ? { tabId: input.tabId } : {}),
    vendor,
    ...(task?.repo ? { repo: task.repo } : {}),
  }))
  const recorded = await store.record(records)
  const last = records[records.length - 1]
  const latest: LatestTurn = last
    ? { id: last.id, model: last.model, usage: last.usage, startedAt: last.startedAt, endedAt: last.endedAt }
    : undefined
  return { recorded, latest }
}

/**
 * Never throws, never awaited. `onDone` ALWAYS runs once (with the latest turn
 * if any) so the caller can defer its turn.complete plugin event onto it.
 */
export function ingestAgentTurnsBestEffort(
  store: AgentTurnsStore | undefined,
  runtime: DaemonRuntimeAdapter,
  orch: DaemonOrchestrator,
  input: TurnIngestInput,
  onDone?: (latest: LatestTurn) => void,
): void {
  if (!store) {
    onDone?.(undefined)
    return
  }
  void ingestAgentTurns(store, runtime, orch, input)
    .then(({ latest }) => onDone?.(latest))
    .catch((err) => {
      logDaemonError("agent-turns-ingest", err)
      onDone?.(undefined)
    })
}
