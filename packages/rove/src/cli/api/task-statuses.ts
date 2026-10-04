import type { TaskStatus } from "../../types/task.ts"

/** Allowed `--status` values, mirrored from {@link TaskStatus}. */
export const TASK_STATUSES: readonly TaskStatus[] = ["backlog", "in_progress", "in_review", "done", "canceled", "error"]
