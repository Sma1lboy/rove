/**
 * One-time move from "a task holds N engine tabs" to "a task is one
 * conversation": every engine tab beyond a task's canonical one becomes a
 * shared child task. Runs at daemon boot, after the task index and the tab
 * store are loaded and before any client connects.
 *
 * - Tab whose hosted PTY is live: the child is aliased to that PTY
 *   (`ptyAlias`) and its own tab list holds one viewport tab onto it.
 *   Nothing is re-keyed or restarted.
 * - Dead tab with a `sessionId`: the child's `tab-1` resumes that session.
 * - Dead tab without one but with a transcript (`spawned`): the child's `tab-1`
 *   continues from the directory's own history.
 * - Dead tab that never ran: nothing to resume, dropped.
 *
 * Done-ness is structural: a migrated tab leaves the parent's snapshot, so a
 * task with one engine tab left plans nothing. A crash between "child exists"
 * and "parent tab closed" re-finds the child (alias, the session its tab pins,
 * or an unseeded child of the same title) instead of minting a second one.
 */

import { lineageRootId, taskCwd, workspaceOwnerId } from "../task-tree.ts"
import type { DaemonOrchestrator, DaemonTask } from "./contracts.ts"
import { logDaemonInfo } from "./crash-log.ts"
import { canonicalEngineTab, ownEngineTabs } from "./engine-tabs.ts"
import type { SharedTabs, TabRow } from "./tabs-ops.ts"
import type { TabsStore } from "./tabs-store.ts"

/** A hosted session as the PTY host lists it. */
export interface HostSession {
  readonly key: string
  readonly alive: boolean
  /** A freeze-restored corpse: scrollback kept, process gone. */
  readonly restored?: boolean
}

export interface MigrationDeps {
  readonly orch: Pick<DaemonOrchestrator, "listTasks" | "createMigratedChild">
  readonly tabs: Pick<TabsStore, "get" | "apply">
  readonly log?: (line: string) => void
}

export interface MigrationReport {
  readonly aliased: number
  readonly resumable: number
  readonly dropped: number
}

/** Fields a child's tab inherits from the parent's tab record. */
const CARRIED = ["title", "autoTitle", "lastTitle", "vendor", "engineCommand", "sessionId"] as const

export const stringField = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined

export function carriedTabFields(tab: TabRow): Record<string, unknown> {
  return Object.fromEntries(CARRIED.flatMap((key) => (tab[key] === undefined ? [] : [[key, tab[key]]])))
}

export async function migrateEngineTabs(
  deps: MigrationDeps,
  sessions: readonly HostSession[] | null,
): Promise<MigrationReport> {
  const log = deps.log ?? ((line) => logDaemonInfo("tabs-migration", line))
  const report = { aliased: 0, resumable: 0, dropped: 0 }
  // An unreadable host is not "no session is live": a live tab would be filed as dead and lose its PTY.
  if (sessions === null) {
    log("PTY host unreadable; engine-tab migration deferred to the next boot")
    return report
  }

  for (const task of deps.orch.listTasks()) {
    const state = deps.tabs.get(task.id).state
    if (!state || task.deletion) continue
    const canonical = canonicalEngineTab(state.tabs)
    const moved: string[] = []
    for (const tab of ownEngineTabs(state.tabs)) {
      if (tab === canonical) continue
      try {
        const outcome = await migrateTab(deps, task, tab, sessions, log)
        report[outcome] += 1
        moved.push(tab.id)
      } catch (err) {
        // The tab stays on the parent, so the next boot plans it again.
        log(`task ${task.id} tab ${tab.id} not migrated: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (moved.length === 0) continue
    deps.tabs.apply(task.id, [
      ...moved.map((id) => ({ op: "close" as const, id })),
      // Closing the focused tab leaves no focus; keep the survivor in front.
      ...(canonical && state.activeId && moved.includes(state.activeId)
        ? [{ op: "focus" as const, id: canonical.id }]
        : []),
    ])
  }
  return report
}

async function migrateTab(
  deps: MigrationDeps,
  task: DaemonTask,
  tab: TabRow,
  sessions: readonly HostSession[],
  log: (line: string) => void,
): Promise<keyof MigrationReport> {
  const session = sessions.find((s) => s.key === `${task.id}::${tab.id}`)
  const live = session?.alive === true && session.restored !== true
  const sessionId = stringField(tab.sessionId)
  // `spawned` = the engine ran and left a transcript, even where it minted no id we know (kimi, codex).
  if (!live && !sessionId && tab.spawned !== true) {
    log(`task ${task.id} tab ${tab.id} dropped: no live PTY, no session and no transcript`)
    return "dropped"
  }

  const alias = live ? { taskId: task.id, tabId: tab.id } : undefined
  const vendor = stringField(tab.vendor)
  const command = stringField(tab.engineCommand)
  const title = stringField(tab.title) ?? stringField(tab.lastTitle) ?? stringField(tab.autoTitle) ?? ""
  // Migrated children hang under the root and share this task's directory.
  const tasks = deps.orch.listTasks()
  const root = lineageRootId(tasks, task.id)
  const owner = workspaceOwnerId(task)
  const existing = tasks.find((t) => {
    if (t.parentTaskId !== root) return false
    if (alias) return t.ptyAlias?.taskId === alias.taskId && t.ptyAlias.tabId === alias.tabId
    // Root children from other directories are someone else's conversations.
    if (t.sharesWorkspaceOf !== owner) return false
    const tabs = deps.tabs.get(t.id).state?.tabs ?? []
    if (sessionId && tabs.some((row) => row.sessionId === sessionId)) return true
    // A crash after the child was created but before its tab was seeded left it empty.
    return (
      !t.ptyAlias && tabs.length === 0 && (title === "" || t.title === title) && t.vendor === (vendor ?? task.vendor)
    )
  })
  const child =
    existing ??
    (await deps.orch.createMigratedChild({
      parentTaskId: task.id,
      title,
      ...(vendor ? { vendor } : {}),
      ...(command ? { command } : {}),
      ...(alias ? { ptyAlias: alias } : {}),
    }))

  // A no-op when the child already has tabs (the crash-resume path).
  const row: TabRow = alias
    ? {
        ...carriedTabFields(tab),
        id: tab.id,
        ordinal: tab.ordinal,
        kind: "engine",
        spawned: true,
        // The parent-keyed PTY; its split leaves (`<key>::leaf-N`) come along with the tab.
        ptyTask: { id: task.id, worktree: taskCwd(task), tabId: tab.id },
        ...(tab.splitTree ? { splitTree: tab.splitTree } : {}),
      }
    : {
        ...carriedTabFields(tab),
        id: "tab-1",
        ordinal: 1,
        kind: "engine",
        ...(tab.spawned === undefined ? {} : { spawned: tab.spawned }),
      }
  const state: SharedTabs = { tabs: [row], nextOrdinal: row.ordinal + 1, activeId: row.id }
  deps.tabs.apply(child.id, [{ op: "seed", state }])
  log(
    alias
      ? `task ${task.id} tab ${tab.id} → child ${child.id}, still running in its PTY`
      : `task ${task.id} tab ${tab.id} → child ${child.id}, resumes ${sessionId ? `session ${sessionId}` : "its transcript"}`,
  )
  return alias ? "aliased" : "resumable"
}
