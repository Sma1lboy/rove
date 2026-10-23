/**
 * Task-tree lineage and shared-workspace helpers, pure over task rows. Lives in
 * the daemon package so cwd attribution, deletion and the orchestrator read the
 * same rules.
 */

import { pathSyntax } from "./path-identity.ts"

/** The slice of a task row these helpers read. */
export interface TreeTask {
  readonly id: string
  readonly parentTaskId?: string
  readonly sharesWorkspaceOf?: string
  readonly worktreePath?: string | null
  readonly cwdSubpath?: string
}

/** Direct children, in list order. */
export function childrenOf<T extends TreeTask>(tasks: readonly T[], id: string): T[] {
  return tasks.filter((task) => task.parentTaskId === id)
}

/** The task whose directory this one runs in: itself unless it shares another's. */
export function workspaceOwnerId(task: TreeTask): string {
  return task.sharesWorkspaceOf ?? task.id
}

export function isSharedChild(task: TreeTask): boolean {
  return task.sharesWorkspaceOf !== undefined
}

/**
 * The top-level task `id` hangs under. A conversation started from a child
 * becomes a sibling of it, so children never nest. A missing ancestor or a
 * cycle stops the walk at the last task seen.
 */
export function lineageRootId(tasks: readonly TreeTask[], id: string): string {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const seen = new Set<string>()
  let current = id
  for (;;) {
    seen.add(current)
    const up = byId.get(current)?.parentTaskId
    if (!up || seen.has(up) || !byId.has(up)) return current
    current = up
  }
}

/** `id` and every descendant, deepest first (a node always follows its children). */
export function subtreeIds(tasks: readonly TreeTask[], id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (current: string): void => {
    if (seen.has(current)) return
    seen.add(current)
    for (const child of childrenOf(tasks, current)) visit(child.id)
    out.push(current)
  }
  visit(id)
  return out
}

/** The directory the engine and shells of this task start in. */
export function taskCwd(task: Pick<TreeTask, "worktreePath" | "cwdSubpath">): string {
  const root = task.worktreePath ?? ""
  if (!root || !task.cwdSubpath) return root
  return pathSyntax(root).join(root, task.cwdSubpath)
}
