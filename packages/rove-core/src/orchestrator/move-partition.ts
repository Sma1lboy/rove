import { isUnlistedCheckout } from "@sma1lboy/rove-core/lib/worktree-only.ts"
import { isUngrouped } from "@sma1lboy/rove-core/types/task-scratch.ts"
import type { Task } from "@sma1lboy/rove-core/types/task.ts"
import { samePath } from "@sma1lboy/rove-daemon/path-identity"

/** The project a row is ordered with; projectless rows (Scratch, a projectless routine's runs) have none. */
export function projectOf(task: Task): string | null {
  return isUngrouped(task) ? null : task.repo
}

/**
 * Call before `task` leaves the lists (archive, delete). A project sits where its first listed task
 * does, so the rest of the project closes up behind `task`: the project keeps its place.
 */
export async function holdProjectPlace(
  store: {
    list(): readonly Task[]
    moveBlock(ids: readonly string[], anchorId: string, side: "before" | "after"): Promise<void>
  },
  task: Task,
): Promise<void> {
  if (projectOf(task) === null) return
  const tasks = store.list()
  const later = tasks
    .slice(tasks.findIndex((t) => t.id === task.id) + 1)
    .filter((t) => projectOf(t) !== null && samePath(t.repo, task.repo))
  if (later.length > 0)
    await store.moveBlock(
      later.map((t) => String(t.id)),
      String(task.id),
      "after",
    )
}

/** The ids `task` reorders among: its repo's tasks with the same pin. */
export function movePartition(tasks: readonly Task[], task: Task): string[] {
  return tasks
    .filter(
      (t) =>
        samePath(t.repo, task.repo) &&
        (t.pinned ?? false) === (task.pinned ?? false) &&
        // No list shows these beside `task`: a step past one would move nothing on screen.
        (t.archived ?? false) === (task.archived ?? false) &&
        (t.id === task.id || !isUnlistedCheckout(t)),
    )
    .map((t) => String(t.id))
}
