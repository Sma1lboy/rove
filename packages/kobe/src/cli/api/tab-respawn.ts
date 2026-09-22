/**
 * Headless revival of FREEZE-RESTORED tabs. A pty-host restart leaves each
 * tab dead with its command, cwd, geometry and scrollback kept; `pty.open`
 * respawns it in place (a TUI attach does this itself, see `docs/SESSIONS.md`).
 * This module picks the argv that brings a DEAD session back (resume verbs +
 * tab snapshot); `pty-delivery.ts` only writes into live ones.
 *
 * Never implicit: `send --tab` refuses a restored tab without `--respawn`,
 * since with no pinned conversation id the frozen command replays verbatim —
 * for claude, including the task's original first prompt.
 */

import type { PtySessionInfo } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import { engineLaunchArgv } from "../../engine/engine-presets.ts"
import { type EngineSessionLaunch, buildEngineSessionLaunch } from "../../engine/session-launch.ts"
import { type EngineTab, engineTabArgv } from "../../tui/workspace/terminal-tabs-core.ts"
import type { VendorId } from "../../types/vendor.ts"
import { readTabsSnapshot } from "./tab-snapshot.ts"

/** One freeze-restored tab: the id a caller addresses it by, plus the
 *  conversation id `--resume` would reopen (absent when none was pinned). */
export interface RestoredTabRef {
  readonly tab: string
  readonly sessionId?: string
}

/**
 * The task's freeze-restored tabs in host order. `exceptKey` drops the tab
 * the caller is about to use. Split leaves never list on their own.
 */
export function restoredTabsOf(
  sessions: readonly PtySessionInfo[],
  taskId: string,
  exceptKey?: string,
): RestoredTabRef[] {
  const prefix = `${taskId}::`
  const ids: string[] = []
  for (const s of sessions) {
    if (s.alive || s.restored !== true || s.key === exceptKey || !s.key.startsWith(prefix)) continue
    const tab = s.key.slice(prefix.length)
    if (tab.includes("::")) continue
    if (!ids.includes(tab)) ids.push(tab)
  }
  const tabs = readTabsSnapshot(taskId)?.tabs ?? []
  return ids.map((tab) => {
    const sessionId = (tabs.find((t) => t.id === tab) as EngineTab | undefined)?.sessionId
    return sessionId ? { tab, sessionId } : { tab }
  })
}

/** What `restoredTabLaunch` needs from the task to compose a tab's argv. */
export interface RespawnTaskContext {
  readonly id: string
  readonly kind?: string
  readonly repo?: string
  readonly vendor?: VendorId
  readonly command?: string
  readonly modelEffort?: string
  readonly model?: string
}

/**
 * Via the same {@link engineTabArgv} as a TUI dead-reattach, so a pinned
 * conversation resumes (`--resume <id>` / `-S <id>` / `resume <id>`) instead
 * of replaying the first prompt. `null` = no such engine tab in the snapshot;
 * the host then falls back to the frozen command.
 */
export function restoredTabLaunch(
  task: RespawnTaskContext,
  tabId: string,
  worktreePath: string,
  shell: string,
): EngineSessionLaunch | null {
  const tab = readTabsSnapshot(task.id)?.tabs.find((t) => t.id === tabId && t.kind === "engine") as
    | EngineTab
    | undefined
  if (!tab) return null
  const base = engineLaunchArgv({
    command: tab.engineCommand ?? (tab.vendor ? undefined : task.command),
    vendor: tab.vendor ?? task.vendor,
    effort: task.modelEffort,
    // A tab pinned to its own engine never inherits the task's model (a claude
    // alias kills a codex launch); same rule as `send --tab new --command`.
    model: tab.engineCommand || tab.vendor ? undefined : task.model,
  })
  return buildEngineSessionLaunch({
    task: { id: task.id, kind: (task.kind as "task") ?? "task", vendor: tab.vendor ?? task.vendor, repo: task.repo },
    worktreePath,
    shell,
    // `live: false` makes this a RESUME rather than a fresh pin.
    argv: engineTabArgv(tab, base, false, task.vendor),
    // The send's prompt is pasted later; an argv prompt would replay the first one.
    promptIntent: { kind: "none" },
    tabId,
  })
}
