/** What the phone's lists show that the desktop rail does not, as pure rules: a session row's second line and age, and the pages extensions add. */

import type { ModPaneView } from "@sma1lboy/rove/src/tui/panes/mods/mods-core.ts"
import type { TaskRow } from "rove-bridge/protocol"
import { compactAge } from "./inbox.ts"
import { createStore } from "./store.ts"
import type { PageId } from "./ui.ts"

/**
 * A session row's second line: its branch, and `↓N` when the branch is N commits behind its base. The count is the
 * daemon's `worktree.changes` push the row already carries (`changes.behind`), the one the TUI sidebar draws as `↓N`.
 */
export function sessionLine2(task: Pick<TaskRow, "branch" | "changes">): { branch: string; behind: string | null } {
  const behind = task.changes && "behind" in task.changes ? (task.changes.behind ?? 0) : 0
  return { branch: task.branch, behind: behind > 0 ? `↓${behind}` : null }
}

/** How long the row has been in its state (`16m`), `—` with no reading. Aged here from the episode's start when the bridge sends it. */
export function sessionAge(task: Pick<TaskRow, "activity">, now: number): string {
  const activity = task.activity
  if (!activity) return "—"
  return compactAge(activity.since !== undefined ? now - activity.since : activity.forMs)
}

/** The short word beside a row's status glyph: a `rail.rowStatus` key, by the same split `row-status-glyph.ts` tones by. */
export function statusWord(
  status: TaskRow["rowStatus"],
): "running" | "needsInput" | "rateLimited" | "error" | "done" | "idle" {
  switch (status?.kind) {
    case "busy":
    case "running":
      return "running"
    case "needs-input":
      return "needsInput"
    case "attention":
      return status.reason === "rate_limited" ? "rateLimited" : "error"
    case "unseen":
      return "done"
    default:
      return "idle"
  }
}

export interface ExtPage {
  /** Stable across reloads: what "last opened" remembers. */
  readonly id: string
  readonly page: PageId
  readonly title: string
  /** A mod pane's plugin. */
  readonly note?: string
  /** A mod pane: the Mods page shows this one alone. */
  readonly pane?: string
}

/** The pages extensions add: the installed first-party mods' own pages, then every open mod pane. */
export function extPages(
  installed: ReadonlySet<string>,
  panes: readonly ModPaneView[],
  names: { readonly kanban: string; readonly issues: string },
): ExtPage[] {
  const builtin = (["kanban", "issues"] as const)
    .filter((id) => installed.has(id))
    .map((id): ExtPage => ({ id, page: id, title: names[id] }))
  const mods = panes.map((pane): ExtPage => {
    const key = `${pane.plugin}/${pane.id}`
    return { id: `mod:${key}`, page: "mods", title: pane.title, note: pane.plugin, pane: key }
  })
  return [...builtin, ...mods]
}

const LAST_KEY = "rove.web.extPage"
const savedLast = (): string | null => {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}
/** The extension page opened last, kept across visits like the rail's folds. */
export const lastExtPage = createStore<string | null>(typeof localStorage === "undefined" ? null : savedLast())
/** The one mod pane the Mods page shows on a phone; null = all of them. */
export const modPane = createStore<string | null>(null)

export function rememberExtPage(entry: ExtPage): void {
  lastExtPage.set(entry.id)
  modPane.set(entry.pane ?? null)
  try {
    localStorage.setItem(LAST_KEY, entry.id)
  } catch {}
}
