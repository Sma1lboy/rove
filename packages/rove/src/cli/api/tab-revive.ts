/**
 * Headless "bring this tab's session back" (`rove api tab-revive`): the open a
 * TUI attach does for a tab whose PTY is gone (dead, freeze-restored, or wiped
 * with the host's freeze records). Never implicit and never replays a prompt:
 * an engine resumes its persisted conversation, else starts fresh with no
 * first message.
 */

import { resolveSessionShell } from "@sma1lboy/rove-daemon/daemon/platform-shell"
import type { PtyOpenResult } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { PtySessionInfo } from "@sma1lboy/rove-daemon/daemon/pty-host"
import { engineResumeArgv, withPinnedSessionId } from "../../engine/engine-presets.ts"
import type { HostedSessionRpc } from "../../engine/hosted-session.ts"
import { RemoteEngineLaunchError, buildEngineSessionLaunch } from "../../engine/session-launch.ts"
import { trustEngineWorktree } from "../../engine/trust-worktree.ts"
import { persistedMaxLiveEngines } from "../../state/engine-limit.ts"
import { readPersistedTerminalDefaultColors } from "../../tui/lib/terminal-colors.ts"
import { shellIdentityInput } from "../../tui/workspace/terminal-tab-spawn.ts"
import type { CommandTab, EngineTab } from "../../tui/workspace/terminal-tabs-core.ts"
import { AT_REST_STATES, readActivityRegistry } from "./activity-view.ts"
import { openAdmittedEngine } from "./engine-admission.ts"
import { ensureHostFor, sessionFailed } from "./session-failed.ts"
import { createdFresh } from "./tab-new.ts"
import { tabEngineBase } from "./tab-respawn.ts"
import { type TabsRpc, markCliTabSession, readDaemonTabs, seedCanonicalTab } from "./tab-snapshot.ts"
import { ApiError, type PromptTarget } from "./types.ts"

export interface RevivedTab {
  readonly busy?: string
  /** A session was opened (or respawned) by this call. */
  readonly revived: boolean
  /** The tab's PTY was already running; nothing was touched. */
  readonly alive?: true
  /** The persisted conversation was reopened, not a fresh one started. */
  readonly resumed: boolean
  /** The conversation the tab runs now, when the engine takes or reports one. */
  readonly sessionId?: string
}

const NO_OP: RevivedTab = { revived: false, alive: true, resumed: false }

/** An engine row's launch: resume its conversation, else a fresh one pinned where the engine accepts a caller-set id. */
function engineRelaunch(target: PromptTarget, row: EngineTab, worktree: string) {
  const base = tabEngineBase(target, row)
  const vendor = row.vendor ?? target.vendor
  const resumeArgv = row.sessionId && row.spawned ? engineResumeArgv(base, vendor, row.sessionId) : null
  // A recorded id never started is re-pinned as is; engines that mint their own ids get none.
  const pinned = resumeArgv
    ? null
    : withPinnedSessionId(base, vendor, row.sessionId ? () => row.sessionId as string : undefined)
  trustEngineWorktree(vendor, worktree)
  const launch = buildEngineSessionLaunch({
    task: { id: target.id, kind: target.kind, vendor, repo: target.repo },
    worktreePath: worktree,
    shell: resolveSessionShell(),
    argv: resumeArgv ?? pinned?.argv ?? base,
    promptIntent: { kind: "none" },
    tabId: row.id,
  })
  return { launch, resumed: resumeArgv !== null, sessionId: resumeArgv ? row.sessionId : pinned?.sessionId }
}

async function openEngineTab(
  client: TabsRpc,
  rpc: HostedSessionRpc,
  target: PromptTarget,
  row: EngineTab,
  worktree: string,
): Promise<RevivedTab> {
  const { launch, resumed, sessionId } = engineRelaunch(target, row, worktree)
  const open = await openAdmittedEngine(
    rpc,
    { key: launch.key, cwd: worktree, command: launch.command, defaultColors: readPersistedTerminalDefaultColors() },
    {
      maxLiveEngines: persistedMaxLiveEngines(),
      taskId: target.id,
      retryArgs: ["api", "tab-revive", "--task-id", target.id, "--tab", row.id],
    },
  )
  // Someone else's open won the race: their session is the tab's now.
  if (!createdFresh(open) && open.respawned !== true) return NO_OP
  if (!open.alive) {
    throw sessionFailed(
      target.id,
      `the engine in tab ${row.id} exited as it started`,
      "the session was reopened but nothing stayed running in it — fix the task's launch command (`api update --command`), then retry",
      { session: launch.key },
    )
  }
  await markCliTabSession(client, target.id, row.id, sessionId ?? null)
  return { revived: true, resumed, ...(sessionId ? { sessionId } : {}) }
}

async function openCommandTab(
  rpc: HostedSessionRpc,
  target: PromptTarget,
  row: CommandTab,
  worktree: string,
): Promise<RevivedTab> {
  const key = `${target.id}::${row.id}`
  const open = await rpc.request<PtyOpenResult>("pty.open", {
    key,
    cwd: worktree,
    command: row.command,
    defaultColors: readPersistedTerminalDefaultColors(),
  })
  if (!createdFresh(open) && open.respawned !== true) return NO_OP
  if (!open.alive) {
    throw sessionFailed(target.id, `the command in tab ${row.id} exited as it started`, "run `get-task` for the tab", {
      session: key,
    })
  }
  // A bare login shell gets its task and tab ids exported again, as `tab-new` does on its own spawn.
  if (row.command.length === 1 && !row.purpose) {
    await rpc.request("pty.write", { key, data: shellIdentityInput(target.id, row.id) })
  }
  return { revived: true, resumed: false }
}

/**
 * Reopen one tab's own session (`<taskId>::<tabId>`) when no PTY is running in
 * it. The row is the tab's identity: no row (or a split leaf, a viewport, a
 * content tab) is refused rather than guessed at.
 */
export async function reviveTab(
  client: TabsRpc,
  target: PromptTarget,
  tabId: string,
  worktree: string,
  /** `replaceExited`: the caller saw the engine gone from a running session (keepAlive's fallback shell); close it and relaunch. */
  opts: { readonly replaceExited?: boolean; readonly restartUpdatedGeneration?: string } = {},
): Promise<RevivedTab> {
  const host = await ensureHostFor(
    target.id,
    "no PTY host to run the tab in — nothing was started; check `rove daemon status`, then retry",
  )
  const key = `${target.id}::${tabId}`
  try {
    const { sessions = [] } = await host.rpc.request<{ sessions?: PtySessionInfo[] }>("pty.list", {})
    const listed = sessions.find((s) => s.key === key)
    if (listed?.alive && !opts.replaceExited && !opts.restartUpdatedGeneration) return NO_OP
    let row = (await readDaemonTabs(client, target.id))?.tabs.find((t) => t.id === tabId)
    // A session the daemon never listed (its first start failed before the tab was recorded) is the task's own tab-1.
    if (!row && listed && tabId === "tab-1") row = await seedCanonicalTab(client, target.id)
    if (!row) {
      throw new ApiError(`tab ${tabId} is not a tab of task ${target.id}`, "TAB_NOT_FOUND", {
        taskId: target.id,
        hint: "pick a tab id from `get-task` .tabs[]",
        nextCommandArgs: ["api", "get-task", "--task-id", target.id],
      })
    }
    if (row.kind === "content" || (row.kind === "engine" && row.ptyTask)) {
      const why =
        row.kind === "content" ? "is a preview with no session" : `is a view of task ${row.ptyTask?.id}'s session`
      throw new ApiError(`tab ${tabId} on task ${target.id} ${why}`, "TAB_NOT_REVIVABLE", {
        taskId: target.id,
        tabId,
        hint: "pick a shell or engine tab from `get-task` .tabs[], or revive a view's session under its own task",
        nextCommandArgs: ["api", "get-task", "--task-id", target.id],
      })
    }
    // A freeze-restored corpse is respawned in place by `pty.open`; an ordinary dead one is view-only there, so clear it first.
    if (opts.restartUpdatedGeneration) {
      if (!listed?.alive || listed.generation !== opts.restartUpdatedGeneration) return NO_OP
      if (!listed.programStatusEvent) return { ...NO_OP, busy: "unknown" }
      const registry = await readActivityRegistry(client)
      const state = registry?.tabs[target.id]?.[tabId]?.state ?? "unknown"
      if (!AT_REST_STATES.has(state)) return { ...NO_OP, busy: state }
      const result = await host.rpc.request<{ accepted?: boolean }>("pty.killAtRest", {
        key,
        expectedGeneration: opts.restartUpdatedGeneration,
        expectedRevision: listed.programStatusEvent.revision,
      })
      if (result.accepted !== true) return { ...NO_OP, busy: "unknown" }
    } else if (listed && listed.restored !== true) {
      await host.rpc.request("pty.kill", { key, wait: true })
    }
    return row.kind === "engine"
      ? await openEngineTab(client, host.rpc, target, row, worktree)
      : await openCommandTab(host.rpc, target, row, worktree)
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof RemoteEngineLaunchError) {
      throw new ApiError(error.message, error.code, {
        taskId: target.id,
        hint: "an SSH-backed project's engine cannot be launched from this machine; open the task on the machine that holds it",
      })
    }
    throw sessionFailed(
      target.id,
      `reviving tab ${tabId} failed for ${target.id}: ${error instanceof Error ? error.message : String(error)}`,
      "the PTY host or the daemon refused the open — check `rove daemon status`, then retry",
    )
  } finally {
    await host.rpc.request("pty.detach", { key }).catch(() => {})
    host.close()
  }
}
