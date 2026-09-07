/**
 * Reviving a FREEZE-RESTORED terminal tab from the CLI.
 *
 * A pty-host restart (a reboot, a crash, `pty-host` killed) leaves every tab
 * as a thawed corpse: the frozen record keeps its command, cwd, geometry and
 * scrollback, and `pty.open` respawns the child in place. A TUI attach does
 * that on its own (`docs/SESSIONS.md`, "Detaching and reattaching"); nothing
 * headless could reach it, so after a reboot every task's real conversation
 * was unreachable until a human opened the TUI.
 *
 * Separate from `pty-delivery.ts` because the two answer different
 * questions. Delivery writes into a session that is already running; this
 * module decides what argv brings a DEAD one back — which is engine
 * knowledge (`engineTabArgv`'s resume verbs) plus the persisted tab
 * snapshot, neither of which delivery reads.
 *
 * The respawn is never implicit: `send --tab tab-N` still refuses a restored
 * tab unless the caller passes `--respawn`. Re-running a tab's recorded
 * launch command is a side effect the caller has to ask for — for a tab with
 * no pinned conversation id the frozen command is replayed verbatim, and for
 * a claude tab that command carries the task's original first prompt as a
 * positional argument.
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
 * The task's freeze-restored (thawed, dead) tabs — the conversations a host
 * restart froze, in the order the host lists them. `exceptKey` drops the tab
 * the caller is about to use, so a disclosure names only the ones it passed
 * over. Split leaves belong to their tab and never list on their own.
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
}

/**
 * The launch that brings tab `tabId` back. Composed through the same
 * {@link engineTabArgv} a TUI dead-reattach uses, so a tab with a pinned
 * conversation comes back as `--resume <id>` (claude) / `-S <id>` (kimi) /
 * `resume <id>` (codex) rather than replaying its original first prompt.
 * `null` when the snapshot has no engine tab by that id — the caller then has
 * no argv of its own and the host falls back to the frozen command.
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
  })
  return buildEngineSessionLaunch({
    task: { id: task.id, kind: (task.kind as "task") ?? "task", vendor: tab.vendor ?? task.vendor, repo: task.repo },
    worktreePath,
    shell,
    // `live: false` is the fact that makes this a RESUME rather than a fresh
    // pin: the tab spawned before, its PTY is gone, and its conversation is
    // the one to reopen.
    argv: engineTabArgv(tab, base, false, task.vendor),
    // The prompt this send carries is PASTED after the engine is up, never
    // woven into the launch — a resumed conversation must not replay the
    // task's first prompt, which is exactly what an argv-carried one does.
    promptIntent: { kind: "none" },
    tabId,
  })
}
