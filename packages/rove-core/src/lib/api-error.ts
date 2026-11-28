/** A `rove api` verb's typed refusal: the CLI prints it as the `{error:{message,code,...}}` envelope. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** Extra context merged into the error JSON — e.g. `taskId` when create
     *  succeeded but delivery failed, so a script keeps the engine-burning task.
     *  Rejection sites SHOULD include `hint` (one sentence: what next) and
     *  `nextCommandArgs` (argv without the executable, runnable verbatim, e.g.
     *  `["api", "schema"]`). Additive: envelope stays `{error:{message,code,...}}`. */
    readonly data?: Record<string, unknown>,
  ) {
    super(message)
  }
}

/** Refusal for anything that would start a session on an archived task (send, tab-revive): archiving stopped them. */
export const TASK_ARCHIVED = "TASK_ARCHIVED"

export function taskArchivedError(taskId: string): ApiError {
  return new ApiError(`task ${taskId} is archived; nothing was sent or started`, TASK_ARCHIVED, {
    taskId,
    hint: `unarchive it first: rove api unarchive --task-id ${taskId}`,
    nextCommandArgs: ["api", "unarchive", "--task-id", taskId],
  })
}
