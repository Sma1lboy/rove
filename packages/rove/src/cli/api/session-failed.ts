import type { HostedSessionClient } from "../../engine/hosted-session.ts"
import { ensurePtyHost } from "./pty-delivery.ts"
import { ApiError } from "./types.ts"

/**
 * Every SESSION_FAILED refusal. The task already EXISTS when these fire, so
 * the error must carry its id, or a fan-out loses the task it just created.
 */
export function sessionFailed(
  taskId: string,
  message: string,
  hint: string,
  extra?: Record<string, unknown>,
): ApiError {
  return new ApiError(message, "SESSION_FAILED", {
    taskId,
    ...extra,
    hint,
    // The session's own output is where the cause is, in all four cases.
    nextCommandArgs: ["api", "read-output", "--task-id", taskId, "--source", "terminal"],
  })
}

/** Start the standalone PTY host if needed and connect, or refuse with SESSION_FAILED (`hint` says what was not started). */
export async function ensureHostFor(taskId: string, hint: string): Promise<HostedSessionClient> {
  try {
    return await ensurePtyHost()
  } catch (error) {
    throw sessionFailed(
      taskId,
      `failed to start PTY host for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      hint,
    )
  }
}
