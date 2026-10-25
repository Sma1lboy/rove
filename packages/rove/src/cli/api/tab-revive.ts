/**
 * `rove api tab-revive`: bring ONE persisted tab whose session is gone back
 * under its own key, the way a TUI attach does (`TerminalTabs` acquire): an
 * engine tab resumes its pinned conversation, a command tab reruns its
 * command. The web/phone calls this before attaching, so opening a task whose
 * pty died (host restart, reboot, an exited engine) shows the session again
 * instead of "this tab has no running session".
 *
 * Never a new tab and never a prompt: the row must already exist, and a live
 * session is left alone.
 */

import { resolveLoginShell } from "@sma1lboy/rove-daemon/daemon/platform-shell"
import type { PtyOpenResult } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { PtySessionInfo } from "@sma1lboy/rove-daemon/daemon/pty-host"
import type { HostedSessionRpc } from "../../engine/hosted-session.ts"
import { trustEngineWorktree } from "../../engine/trust-worktree.ts"
import { persistedMaxLiveEngines } from "../../state/engine-limit.ts"
import { readPersistedTerminalDefaultColors } from "../../tui/lib/terminal-colors.ts"
import { shellIdentityInput } from "../../tui/workspace/terminal-tab-spawn.ts"
import type { CommandTab } from "../../tui/workspace/terminal-tabs-core.ts"
import { openAdmittedEngine } from "./engine-admission.ts"
import { ensureHostFor } from "./session-failed.ts"
import { type RespawnTaskContext, restoredTabLaunch } from "./tab-respawn.ts"
import { readTabsSnapshot } from "./tab-snapshot.ts"
import { ApiError } from "./types.ts"

export interface RevivedTab {
  readonly session: string
  /** false = the session was already live; nothing was started. */
  readonly revived: boolean
  readonly alive: boolean
}

/** Revive `tabId` of `task` in `cwd` on `rpc`; see the module comment. */
export async function reviveTab(
  rpc: HostedSessionRpc,
  task: RespawnTaskContext,
  tabId: string,
  cwd: string,
): Promise<RevivedTab> {
  const key = `${task.id}::${tabId}`
  const { sessions = [] } = await rpc.request<{ sessions?: PtySessionInfo[] }>("pty.list", {})
  const session = sessions.find((s) => s.key === key)
  if (session?.alive) return { session: key, revived: false, alive: true }

  const tab = readTabsSnapshot(task.id)?.tabs.find((t) => t.id === tabId)
  if (!tab) throw new ApiError(`task ${task.id} has no tab ${tabId}`, "TAB_NOT_FOUND")
  if (tab.kind !== "engine" && tab.kind !== "command") {
    throw new ApiError(`tab ${tabId} is a ${tab.kind} tab; only engine and command tabs run a session`, "UNSUPPORTED")
  }
  // A freeze-restored corpse respawns in place (scrollback kept); an ordinary
  // corpse is view-only to `pty.open`, so it has to go first.
  if (session && session.restored !== true) await rpc.request("pty.kill", { key })

  const shell = resolveLoginShell({ fallback: "/bin/zsh" })
  const defaultColors = readPersistedTerminalDefaultColors()
  let open: PtyOpenResult
  try {
    if (tab.kind === "engine") {
      const launch = restoredTabLaunch(task, tabId, cwd, shell)
      if (!launch) throw new ApiError(`tab ${tabId} has no engine to resume`, "TAB_NOT_FOUND")
      trustEngineWorktree(tab.vendor ?? task.vendor, cwd)
      open = await openAdmittedEngine(
        rpc,
        { key, cwd, command: launch.command, defaultColors },
        {
          maxLiveEngines: persistedMaxLiveEngines(),
          taskId: task.id,
          retryArgs: ["api", "tab-revive", "--task-id", task.id, "--tab", tabId],
        },
      )
    } else {
      const command = (tab as CommandTab).command
      open = await rpc.request<PtyOpenResult>("pty.open", { key, cwd, command, defaultColors })
      // Same identity export a fresh shell tab gets, so an engine typed there reports to this tab.
      if (open.alive && command.length === 1 && isShell(command[0])) {
        await rpc.request("pty.write", { key, data: shellIdentityInput(task.id, tabId) })
      }
    }
  } finally {
    await rpc.request("pty.detach", { key }).catch(() => {})
  }
  return { session: key, revived: true, alive: open.alive }
}

/** A bare login shell (what `tab-new --kind shell` records), not a program typed input would reach. */
function isShell(bin: string | undefined): boolean {
  return /^(sh|bash|zsh|fish|ksh|dash|tcsh|csh|nu)$/.test(bin?.split("/").pop() ?? "")
}

/** {@link reviveTab} on this machine's PTY host. */
export async function reviveTerminalTab(task: RespawnTaskContext, tabId: string, cwd: string): Promise<RevivedTab> {
  const host = await ensureHostFor(
    task.id,
    "no PTY host to run the tab in — nothing was started; check `rove daemon status`, then retry",
  )
  try {
    return await reviveTab(host.rpc, task, tabId, cwd)
  } finally {
    host.close()
  }
}
