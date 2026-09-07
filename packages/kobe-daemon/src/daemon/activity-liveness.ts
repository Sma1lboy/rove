/** Session-scoped evidence for the activity lapse watchdog. Unknown is not completion. */

import { stat } from "node:fs/promises"
import type { ActivityLiveness } from "./activity-registry.ts"
import type { VendorId } from "./contracts.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"

/** The slice of the orchestrator this probe reads. */
export interface LivenessTaskLookup {
  getTask(taskId: string): { worktreePath?: string; vendor?: VendorId } | undefined
}

export type LivenessRuntime = Pick<
  DaemonRuntimeAdapter,
  "createEngineTurnDetector" | "latestTranscriptMtime" | "defaultTaskVendor"
>

export async function readActivityLiveness(
  orch: LivenessTaskLookup,
  runtime: LivenessRuntime,
  taskId: string,
  reportedVendor?: string,
  transcriptPath?: string,
): Promise<ActivityLiveness | undefined> {
  const task = orch.getTask(taskId)
  if (!task?.worktreePath) return undefined
  // The hook's own `--engine` tag outranks the task's configured vendor: a
  // custom wrapper id (`claudecpa` → cc-switch → claude) has no transcript
  // store of its own, so probing by task.vendor read mtime 0 and lapsed
  // every long turn to idle mid-work.
  const vendor = (reportedVendor as VendorId | undefined) ?? task.vendor ?? runtime.defaultTaskVendor
  const detector = runtime.createEngineTurnDetector(vendor)
  if (transcriptPath) {
    if (!detector?.supportsCompletionMarkers()) {
      try {
        const file = await stat(transcriptPath)
        return file.isFile() ? { mtimeMs: file.mtimeMs } : { unknown: true }
      } catch {
        return { unknown: true }
      }
    }
    try {
      const scoped = await detector.latestActivityInFile(transcriptPath)
      if (!scoped) return { unknown: true }
      return {
        ...(scoped.mtimeMs > 0 ? { mtimeMs: scoped.mtimeMs } : {}),
        ...(scoped.marker ? { completedAt: scoped.marker.timestampMs } : {}),
      }
    } catch {
      return { unknown: true }
    }
  }
  if (!detector?.supportsCompletionMarkers()) {
    const mtimeMs = await runtime.latestTranscriptMtime(vendor, task.worktreePath)
    return mtimeMs > 0 ? { mtimeMs } : {}
  }
  const { marker, mtimeMs } = await detector.latestActivity(task.worktreePath)
  return {
    ...(mtimeMs > 0 ? { mtimeMs } : {}),
    ...(marker ? { completedAt: marker.timestampMs } : {}),
  }
}
