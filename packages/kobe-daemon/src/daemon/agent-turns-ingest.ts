/**
 * Turn-telemetry ingest (issue #32): the bridge from an engine hook report to
 * the durable {@link AgentTurnsStore}.
 *
 * Fired on `turn-complete`, the one event that means "a turn just finished and
 * its records are on disk". Everything here is best-effort and fire-and-forget
 * — the hook RPC must not wait on a transcript read, and a telemetry failure
 * must never surface to the engine.
 *
 * The vendor read is delegated to the runtime adapter (`readEngineTurns`), so
 * the daemon stays vendor-blind: it supplies a path and an engine id, and the
 * engine's own adapter decides what a turn is.
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

/**
 * Read the finished turns out of `transcriptPath` and merge them into the
 * store, joined to the task's identity. Resolves to the number of NEW turns
 * (0 when the transcript held nothing unseen, which is the common case since
 * every read starts from the top of the file).
 */
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
 * Fire-and-forget wrapper for the hook path: never throws, never awaited.
 * `onDone` (when given) ALWAYS runs exactly once — with the just-finished
 * turn when the transcript yielded one, without it otherwise — so the caller
 * can defer its turn.complete plugin event onto the enriched data.
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
