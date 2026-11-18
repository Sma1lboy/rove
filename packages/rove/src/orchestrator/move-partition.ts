import { samePath } from "@sma1lboy/rove-daemon/path-identity"
import { isUnlistedCheckout } from "../lib/worktree-only.ts"
import type { Task } from "../types/task.ts"

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
