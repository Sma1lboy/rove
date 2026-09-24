/**
 * Real side effects behind `api` verbs: hosted prompt delivery and the
 * default {@link ApiRuntime}. Handlers depend only on the `ApiRuntime` TYPE,
 * so unit tests never open a PTY host or git.
 */

import { resolveLoginShell } from "@sma1lboy/kobe-daemon/daemon/platform-shell"
import type { PtySessionExit } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { engineLaunchArgv, withPinnedSessionId } from "../../engine/engine-presets.ts"

import { buildEngineSessionLaunch } from "../../engine/session-launch.ts"
import { trustEngineWorktree } from "../../engine/trust-worktree.ts"
import { type TerminalTab, tabPtyKeyFor } from "../../tui/workspace/terminal-tabs-core.ts"
import { type DaemonRpc, resolveActiveTaskId } from "../daemon-session.ts"

// New callers: import from daemon-session.ts directly.
export { resolveActiveTaskId }
import { deliverToExactTab } from "./exact-tab-delivery.ts"
import { handlePtyList } from "./handler-helpers.ts"
import {
  deliverHostedPrompt,
  ensurePtyHost,
  killTaskSessions,
  listSessions,
  listSessionsOrNull,
  openPtyHost,
  taskKeys,
} from "./pty-delivery.ts"
import { restoredTabLaunch } from "./tab-respawn.ts"
import {
  type TaskSessionRow,
  closeTabsSnapshot,
  joinTaskTabs,
  markCliTabSession,
  mintCliTab,
  publishCliTabSnapshot,
  readTabsSnapshot,
} from "./tab-snapshot.ts"
import { hasLiveEngineTab } from "./task-running.ts"
import { ApiError, type ApiRuntime, type DeliveredPrompt, type PromptDeliveryOps, type PromptTarget } from "./types.ts"

/**
 * Every SESSION_FAILED refusal. The task already EXISTS when these fire, so
 * the error must carry its id, or a fan-out loses the task it just created.
 */
function sessionFailed(taskId: string, message: string, hint: string, extra?: Record<string, unknown>): ApiError {
  return new ApiError(message, "SESSION_FAILED", {
    taskId,
    ...extra,
    hint,
    // The session's own output is where the cause is, in all four cases.
    nextCommandArgs: ["api", "read-output", "--task-id", taskId, "--source", "terminal"],
  })
}

/** Ensure and address the task's hosted engine session (`target.tab` routes:
 *  undefined = canonical, "new" = mint + spawn a fresh tab, "tab-N" = that
 *  exact alive tab only). */
async function deliverHosted(target: PromptTarget, worktree: string, prompt: string): Promise<DeliveredPrompt> {
  let host: Awaited<ReturnType<typeof ensurePtyHost>>
  try {
    host = await ensurePtyHost()
  } catch (error) {
    throw sessionFailed(
      target.id,
      `failed to start PTY host for ${target.id}: ${error instanceof Error ? error.message : String(error)}`,
      "no PTY host to run the engine in — nothing was started; check `rove daemon status`, then retry the same send",
    )
  }
  try {
    // Exact tab: deliver-only, never spawn — a dead/absent tab is
    // TAB_NOT_FOUND. engineBin covers a CUSTOM engine; builtins the foreground
    // gate recognizes on its own (cross-vendor send stays open).
    if (target.tab && target.tab !== "new") {
      const engineBin = engineLaunchArgv({
        command: target.command,
        vendor: target.vendor,
        effort: target.modelEffort,
        model: target.model,
      })[0]
      const tabId = target.tab
      return await deliverToExactTab(host.rpc, target.id, tabId, worktree, prompt, {
        engineBin,
        // Only with explicit `send --respawn`; lazy so the snapshot is read
        // only when reviving a tab a pty-host restart froze.
        ...(target.respawn
          ? {
              respawn: () => restoredTabLaunch(target, tabId, worktree, resolveLoginShell({ fallback: "/bin/zsh" })),
            }
          : {}),
      })
    }
    const newTab = target.tab === "new" ? mintCliTab(target.id, target.tabVendor, target.tabCommand) : undefined
    // A `--tab new` pin (command and/or protocol) applies to THIS launch
    // only; the task's own engine is left alone.
    const launchVendor = target.tabVendor ?? target.vendor
    const launchCommand = target.tabCommand ?? (target.tabVendor ? undefined : target.command)
    // Pin the session id up front (same contract as the TUI) so a reattach
    // after a pty-host restart resumes THIS conversation. Engines that mint
    // their own id (kimi/codex) return null and are discovered post-spawn.
    const { argv, sessionId } = withPinnedSessionId(
      engineLaunchArgv({
        command: launchCommand,
        vendor: launchVendor,
        effort: target.modelEffort,
        model: target.model,
      }),
      launchVendor,
    )
    // A hosted session can't answer a trust dialog; no-op for generic protocols.
    trustEngineWorktree(launchVendor, worktree)
    const launch = buildEngineSessionLaunch({
      task: { id: target.id, kind: target.kind, vendor: launchVendor, repo: target.repo },
      worktreePath: worktree,
      shell: resolveLoginShell({ fallback: "/bin/zsh" }),
      argv,
      promptIntent: target.newTask ? { kind: "new-task", prompt } : { kind: "explicit", prompt },
      tabId: newTab,
    })
    const result = await deliverHostedPrompt(
      host.rpc,
      { id: target.id, engineBin: argv[0] },
      worktree,
      prompt,
      launch,
      { forceNew: newTab !== undefined },
    )
    // `started && !delivered` is the real failure. `engineReady` is NOT a
    // stand-in: an engine that never announced bracketed paste can still have
    // been written to. `reason` is the session's own last line.
    if (result.started && !result.delivered) {
      throw sessionFailed(
        target.id,
        `failed to start hosted engine session for ${target.id}`,
        "the session was created but no engine ran in it — fix the task's launch command (`api update --command`), then retry with `api send --tab new`",
        {
          session: result.session,
          engineReady: result.engineReady,
          ...(result.reason ? { reason: result.reason } : {}),
        },
      )
    }
    // Make the session visible in the sidebar (`--tab new` already appended
    // its tab in mintCliTab). Write-once; see `tab-snapshot.ts`.
    if (!newTab) publishCliTabSnapshot(target.id, result.started ? sessionId : undefined)
    if (result.started && sessionId) {
      // publishCliTabSnapshot no-ops on an existing snapshot, which would
      // leave the PREVIOUS conversation's id after a host-restart respawn of
      // tab-1, and `--resume` would reopen the wrong one. Recording the id of
      // a session this process just started doesn't fight the TUI.
      const startedTab = newTab ?? result.session.split("::")[1]
      if (startedTab) markCliTabSession(target.id, startedTab, sessionId)
    }
    return result
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw sessionFailed(
      target.id,
      `hosted engine session failed for ${target.id}: ${error instanceof Error ? error.message : String(error)}`,
      "the hosted session threw while starting or delivering — read its terminal tail for the cause, then retry the send",
    )
  } finally {
    host.close()
  }
}

const realPromptDeliveryOps: PromptDeliveryOps = { deliverHosted }

/** Headless half of ctrl+w: remove the persisted tab, then end every hosted
 * PTY the tab owns. Attached TUIs run their existing close path instead. */
async function closeHeadlessTerminalTab(
  taskId: string,
  tabId: string,
): Promise<{ kind: TerminalTab["kind"]; wasAlive: boolean }> {
  const host = await openPtyHost()
  try {
    const sessions = host ? await listSessions(host.rpc) : []
    const snapshot = readTabsSnapshot(taskId)
    const saved = snapshot?.tabs.find((tab) => tab.id === tabId)
    const directKey = `${taskId}::${tabId}`
    const unregisteredAlive = sessions.some((session) => session.key === directKey && session.alive)
    if (!saved && !unregisteredAlive) {
      throw new ApiError(`tab ${tabId} does not exist on task ${taskId}`, "TAB_NOT_FOUND", {
        hint: "refresh the task's tab ids with get-task, then retry with one of its .tabs[].id values",
        nextCommandArgs: ["api", "get-task", "--task-id", taskId],
      })
    }

    const closing = saved ? closeTabsSnapshot(taskId, tabId) : undefined
    if (saved && !closing) {
      throw new ApiError(`tab ${tabId} no longer exists on task ${taskId}`, "TAB_NOT_FOUND", {
        hint: "the tab closed while this command was running; refresh with get-task before retrying",
        nextCommandArgs: ["api", "get-task", "--task-id", taskId],
      })
    }

    const baseKey = closing ? tabPtyKeyFor(taskId, closing) : directKey
    const ownsBase = !(closing?.kind === "engine" && closing.ptyTask)
    // `ownsBase` gates the SPLIT LEAVES too. For a viewport tab `baseKey` is
    // the REFERENCED task's key (`tabPtyKeyFor` resolves through `ptyTask`), so
    // `<referenced>::tab-1::leaf-N` are that task's own splits — closing the
    // borrowing tab must not kill them any more than it kills the base.
    const keys = ownsBase
      ? sessions
          .filter((session) => session.key === baseKey || session.key.startsWith(`${baseKey}::`))
          .map((session) => session.key)
      : []
    const wasAlive = sessions.some((session) => keys.includes(session.key) && session.alive)
    if (host) await killTaskSessions(host.rpc, keys)
    return { kind: closing?.kind ?? "engine", wasAlive }
  } finally {
    host?.close()
  }
}

export async function deliverPrompt(
  client: DaemonRpc,
  target: PromptTarget,
  prompt: string,
  ops: PromptDeliveryOps = realPromptDeliveryOps,
): Promise<DeliveredPrompt> {
  let worktree = target.worktreePath
  if (!worktree) {
    const res = await client.request<{ worktreePath: string }>("task.ensureWorktree", { taskId: target.id })
    worktree = res.worktreePath
  }
  if (!worktree) throw new ApiError(`task ${target.id} has no worktree`, "NO_WORKTREE")

  // Learn the user's language from a NEW task's first prompt, for text Rove
  // injects later with no user message in hand (e.g. a timed quota resume).
  // Follow-up sends are out of scope. Best-effort: never blocks the prompt.
  if (target.newTask) {
    await client.request("task.observeLanguage", { taskId: target.id, text: prompt }).catch(() => {})
  }

  const hosted = await ops.deliverHosted(target, worktree, prompt)
  if (!hosted)
    throw sessionFailed(
      target.id,
      `failed to start hosted engine session for ${target.id}`,
      "delivery returned nothing — the task exists but has no session; retry with `api send --tab new`",
    )
  return hosted
}

/**
 * Task ids owning a live session, from one fleet-wide `pty.list` (keys are
 * `<taskId>::<tabId>`). `null` when there is no host to ask.
 */
async function readLiveTaskIds(): Promise<ReadonlySet<string> | null> {
  const listed = (await handlePtyList()) as { sessions?: readonly { key?: string; alive?: boolean }[] | null }
  if (!listed?.sessions) return null
  const live = new Set<string>()
  for (const row of listed.sessions) {
    if (row.alive === false || typeof row.key !== "string") continue
    const taskId = row.key.split("::")[0]
    if (taskId) live.add(taskId)
  }
  return live
}

export const defaultApiRuntime: ApiRuntime = {
  liveTaskIds: readLiveTaskIds,
  isTaskRunning: async (taskId, engineArgv) => (await defaultApiRuntime.taskTabs(taskId, engineArgv)).running,
  taskTabs: async (taskId, engineArgv) => {
    // No host = "couldn't ask" (`null`), NOT "nothing alive": reporting
    // `false` would let a cleanup loop delete worktrees holding live work.
    // Persisted tabs still return so the layout stays inspectable.
    let listed: readonly (TaskSessionRow & { pid?: number | null })[] | null = null
    const host = await openPtyHost()
    if (host) {
      try {
        // Tri-state listing: connecting to a stopped host succeeds and only
        // the request fails, so `host !== null` proves nothing.
        listed = await listSessionsOrNull(host.rpc)
      } finally {
        host.close()
      }
    }
    const sessions = listed ?? []
    const hostReachable = listed !== null
    // ONE ps snapshot answers: which vendor is in the foreground
    // (`liveVendor`) and whether ANY engine is in the tree (`engineAlive`,
    // what delivery gates on — `alive` can't tell an engine from keepAlive's
    // login shell). A failed ps leaves `engineAlive` unknown, not false.
    let liveVendors: Map<string, string | null> | undefined
    let engineAlive: Map<string, boolean> | undefined
    try {
      const { engineProcessIn, foregroundEngineIn, parsePsSnapshot, psSnapshot } = await import(
        "../../engine/foreground.ts"
      )
      const walkable = sessions.filter((s) => s.alive && typeof s.pid === "number" && s.pid > 0)
      if (walkable.length > 0) {
        const rows = parsePsSnapshot(await psSnapshot(walkable.map((s) => s.pid as number)))
        liveVendors = new Map(walkable.map((s) => [s.key, foregroundEngineIn(rows, s.pid as number)?.vendor ?? null]))
        // Without `engineArgv` a custom engine walks as "no engine".
        engineAlive = new Map(walkable.map((s) => [s.key, engineProcessIn(rows, s.pid as number, engineArgv)]))
      } else {
        engineAlive = new Map()
      }
    } catch {
      /* recorded liveVendor stays; engineAlive stays unknown */
    }
    // Durable death records outlive the host's idle-exit — a crashed tab
    // still reports its cause here. Best-effort: unreadable = none.
    let exits: Readonly<Record<string, PtySessionExit>> = {}
    try {
      exits = (await import("@sma1lboy/kobe-daemon/daemon/pty-exit-store")).readPtyExitRecords()
    } catch {
      /* keep tabs readable without the records */
    }
    const snapshot = readTabsSnapshot(taskId)
    // Pinned conversation id per tab: the recovery for a dead engine tab
    // (`claude --resume <id>`), which `send --respawn`'s refusal names.
    const sessionIds = new Map(
      (snapshot?.tabs ?? []).map((t) => [t.id, (t as { sessionId?: string | null }).sessionId ?? undefined]),
    )
    return {
      tabs: joinTaskTabs(snapshot, taskId, listed, exits, liveVendors, engineAlive).map((row) => {
        const sessionId = sessionIds.get(row.id)
        return sessionId ? { ...row, sessionId } : row
      }),
      running: hostReachable ? hasLiveEngineTab(snapshot, taskId, sessions, engineAlive, engineArgv?.[0]) : null,
    }
  },
  closeTerminalTab: closeHeadlessTerminalTab,
  deliverPrompt: (client, target, prompt) => deliverPrompt(client, target, prompt),
  resolveRepoRoot: async (absPath) => (await import("../../state/repos.ts")).resolveMainRepoRoot(absPath),
  isUsableRepo: async (absPath) => {
    const { isGitRepo, isRemoteRepoKey } = await import("../../state/repos.ts")
    return isRemoteRepoKey(absPath) || isGitRepo(absPath)
  },
  isValidBranchName: async (branch) => (await import("../../state/repos.ts")).isValidBranchName(branch),
  defaultVendor: async (repo) => {
    const { getGlobalDefaultVendor, getRepoLastActiveVendor } = await import("../../state/vendor-prefs.ts")
    return (repo ? getRepoLastActiveVendor(repo) : undefined) ?? getGlobalDefaultVendor()
  },
  readWorktreeChanges: async (worktreePath) =>
    (await import("../../tui/panes/sidebar/worktree-changes.ts")).readWorktreeChanges(worktreePath),
  readBranchSignals: async (worktreePath, recordedBaseRef) =>
    (await import("./branch-signals.ts")).readBranchSignals(worktreePath, recordedBaseRef),
  tearDownSession: async (taskId) => {
    const host = await openPtyHost()
    if (host) {
      try {
        await killTaskSessions(host.rpc, taskKeys(await listSessions(host.rpc), taskId))
      } catch {
        /* pty-host hiccup must not fail the already-committed RPC */
      } finally {
        host.close()
      }
    }
  },
}
