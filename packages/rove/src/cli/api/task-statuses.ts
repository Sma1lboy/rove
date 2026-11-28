import type { TaskStatus } from "@sma1lboy/rove-core/types/task.ts"

/** Allowed `--status` values, mirrored from {@link TaskStatus}. */
export const TASK_STATUSES: readonly TaskStatus[] = ["backlog", "in_progress", "in_review", "done", "canceled", "error"]
