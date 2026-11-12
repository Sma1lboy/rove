/**
 * Tasks an older Rove added on its own when a worktree was created or a
 * session started in one: still in backlog, still named after the directory.
 * The adopt path left no mark, so this is a shape match (a row the user
 * opened once still counts; one adopted on purpose and never renamed matches
 * too): a caller shows the list to a person before deleting anything.
 */

export interface LegacyAdoptCandidate {
  readonly id: string
  readonly title: string
  readonly worktreePath: string
  readonly kind?: string
  readonly status?: string
  readonly archived?: boolean
  readonly scratch?: boolean
  readonly worktreeOnly?: boolean
  readonly routine?: unknown
  readonly parentTaskId?: string | null
  readonly sharesWorkspaceOf?: string
}

function dirName(p: string): string {
  return (
    p
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) ?? ""
  )
}

export function legacyAdoptedTasks<T extends LegacyAdoptCandidate>(tasks: readonly T[]): T[] {
  return tasks.filter(
    (t) =>
      (t.kind ?? "task") === "task" &&
      t.status === "backlog" &&
      !t.archived &&
      !t.scratch &&
      !t.worktreeOnly &&
      !t.routine &&
      !t.parentTaskId &&
      !t.sharesWorkspaceOf &&
      t.worktreePath !== "" &&
      t.title === dirName(t.worktreePath),
  )
}
