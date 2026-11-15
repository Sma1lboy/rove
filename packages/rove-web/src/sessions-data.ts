/** What the Sessions page lists: one project's sessions (or every project's), live or archived, newest first. */

import type { TabRow, TaskRow, TasksPayload } from "rove-bridge/protocol"
import { repoKey } from "./pages-kit.ts"
import { isNoProject } from "./rail.ts"

export type SessionsTab = "active" | "archived"

/** Milliseconds of a row's last change; a row with no stamp sorts last. */
const stamp = (task: TaskRow): number => Date.parse(task.updatedAt ?? task.createdAt ?? "") || 0

/**
 * `repo` null = every project, sessions in no folder included. A project's main session with no tab open is not a
 * session yet (the rail hides it the same way); one whose tabs are not read yet stays.
 */
export function sessionRows(
  payload: TasksPayload | null | undefined,
  tabs: Readonly<Record<string, readonly TabRow[]>>,
  repo: string | null,
  tab: SessionsTab,
): TaskRow[] {
  const from = tab === "archived" ? (payload?.archived ?? []) : (payload?.tasks ?? [])
  return from
    .filter((task) => repo === null || (!isNoProject(task) && repoKey(task.repo) === repoKey(repo)))
    .filter((task) => tab === "archived" || task.kind !== "main" || tabs[task.id]?.length !== 0)
    .sort((a, b) => stamp(b) - stamp(a))
}

/** Every project with a session, live or archived: an archived-only project is in no rail header. */
export function sessionRepos(payload: TasksPayload | null | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const task of [...(payload?.tasks ?? []), ...(payload?.archived ?? [])]) {
    if (isNoProject(task) || task.repo.startsWith("ssh://")) continue
    const key = repoKey(task.repo)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(task.repo)
  }
  return out
}
