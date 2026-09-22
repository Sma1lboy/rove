/**
 * One global last-focused task id. Last writer wins, deliberately without
 * multi-TUI coordination: opening Rove lands on the most recent focus
 * anywhere. Written on every `setActiveTask`; read once at orchestrator
 * construction so a restart restores focus instead of "first task".
 */

import { loadStateFile, patchStateFile } from "./store.ts"

const LAST_ACTIVE_TASK_KEY = "lastActive.taskId"

export function readLastActiveTaskId(): string | null {
  const value = loadStateFile()[LAST_ACTIVE_TASK_KEY]
  return typeof value === "string" && value ? value : null
}

/** No null: clearing focus keeps the record ("last REAL focus"). */
export function writeLastActiveTaskId(id: string): void {
  patchStateFile({ [LAST_ACTIVE_TASK_KEY]: id })
}
