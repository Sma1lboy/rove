/**
 * The real side-effect implementations `kobe api` verbs run against
 * outside tests: hosted prompt delivery and the
 * default {@link ApiRuntime}. Split out of `api-cmd.ts` (see that file's
 * header) — handlers depend on the `ApiRuntime` TYPE from `./types.ts`,
 * not this module, so unit tests never open PTY Host or git processes.
 */

import type { PtySessionExit } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { engineLaunchArgv, withPinnedSessionId } from "../../engine/engine-presets.ts"

import { buildEngineSessionLaunch } from "../../engine/session-launch.ts"
import { trustEngineWorktree } from "../../engine/trust-worktree.ts"
import { type TerminalTab, tabPtyKeyFor } from "../../tui/workspace/terminal-tabs-core.ts"
import { type DaemonRpc, resolveActiveTaskId } from "../daemon-session.ts"

// Kept for existing callers in this directory; new callers should import from
// daemon-session.ts directly to keep the daemon/session boundary clean.
export { resolveActiveTaskId }
import {
  deliverHostedPrompt,
  deliverToExactTab,
  ensurePtyHost,
  killTaskSessions,
  listSessions,
  openPtyHost,
  taskKeys,
} from "./pty-delivery.ts"
import {
  type TaskSessionRow,
  closeTabsSnapshot,
  hasLiveEngineTab,
  joinTaskTabs,
  markCliTabSession,
  mintCliTab,
  publishCliTabSnapshot,
  readTabsSnapshot,
} from "./tab-snapshot.ts"
import {
  ApiError,
  type ApiRuntime,
  type DeliveredPrompt,
  type PromptDeferralSink,
  type PromptDeliveryOps,
  type PromptTarget,
} from "./types.ts"

/** Ensure and address the task's hosted engine session (`target.tab` routes:
 *  undefined = canonical, "new" = mint + spawn a fresh tab, "tab-N" = that
 *  exact alive tab only). */
async function deliverHosted(
  target: PromptTarget,
  worktree: string,
  prompt: string,
  defer?: PromptDeferralSink,
): Promise<DeliveredPrompt> {
  let host: Awaited<ReturnType<typeof ensurePtyHost>>
  try {
    host = await ensurePtyHost()
  } catch (error) {
    throw new ApiError(
      `failed to start PTY host for ${target.id}: ${error instanceof Error ? error.message : String(error)}`,
      "SESSION_FAILED",
    )
  }
  try {
    // Exact-tab addressing: deliver-only, never spawn — a dead/absent tab is
    // the caller's error (TAB_NOT_FOUND), not a cue to boot a new engine.
    // engineBin covers the task's CUSTOM engine binary; builtins the
    // foreground gate recognizes on its own (cross-vendor send stays open).
    if (target.tab && target.tab !== "new") {
      const engineBin = engineLaunchArgv({
        command: target.command,
        vendor: target.vendor,
        effort: target.modelEffort,
      })[0]
      return await deliverToExactTab(host.rpc, target.id, target.tab, worktree, prompt, {
        engineBin,
        vendor: target.vendor,
        defer,
      })
    }
    const newTab = target.tab === "new" ? mintCliTab(target.id, target.tabVendor, target.tabCommand) : undefined
    // A `--tab new` pin (command and/or protocol) applies to THIS launch
    // only; the task's own engine is left alone.
    const launchVendor = target.tabVendor ?? target.vendor
    const launchCommand = target.tabCommand ?? (target.tabVendor ? undefined : target.command)
    // Pin the conversation's session id up front when the engine accepts
    // one (the same `withPinnedSessionId` contract the TUI launches with),
    // so a LATER reattach after a pty-host restart can resume THIS
    // conversation instead of opening a blank one. Engines that mint their
    // own id (kimi/codex) answer null here and are discovered post-spawn
    // instead. The id lands in the persisted tab snapshot below once the
    // session actually started.
    const { argv, sessionId } = withPinnedSessionId(
      engineLaunchArgv({ command: launchCommand, vendor: launchVendor, effort: target.modelEffort }),
      launchVendor,
    )
    // Pre-trust the worktree in the protocol's first-run store (issue #28) —
    // a hosted session can't answer a trust dialog. A generic protocol has
    // no store kobe knows how to pre-answer, and trustEngineWorktree no-ops.
    trustEngineWorktree(launchVendor, worktree)
    const launch = buildEngineSessionLaunch({
      task: { id: target.id, kind: target.kind, vendor: launchVendor, repo: target.repo },
      worktreePath: worktree,
      shell: process.env.SHELL?.trim() || "/bin/zsh",
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
      {
        forceNew: newTab !== undefined,
        vendor: launchVendor,
        defer,
      },
    )
    // `started && !delivered` is the real failure: the session was created but
    // the prompt never reached it. `engineReady` no longer stands in for that
    // — it is now an independent readiness observation, and an engine that
    // never announced bracketed paste can still have been written to.
    if (result.started && !result.delivered && !result.deferred) {
      throw new ApiError(`failed to start hosted engine session for ${target.id}`, "SESSION_FAILED")
    }
    // Make the session visible to the sidebar tree, which lists a worktree's
    // tabs from the task's persisted snapshot — a CLI-started session used to
    // run live with no snapshot, so the tree showed the worktree with no tabs
    // under it at all. Write-once (a --tab new spawn already appended its tab
    // in mintCliTab); see `tab-snapshot.ts`. When THIS delivery started the
    // session, record the pinned session id + spawned flag too, so a later
    // dead-reattach resumes the conversation (see engineTabArgv).
    if (result.started && sessionId) {
      if (newTab) markCliTabSession(target.id, newTab, sessionId)
      else publishCliTabSnapshot(target.id, sessionId)
    } else if (!newTab) publishCliTabSnapshot(target.id)
    return result
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(
      `hosted engine session failed for ${target.id}: ${error instanceof Error ? error.message : String(error)}`,
      "SESSION_FAILED",
    )
  } finally {
    host.close()
  }
}

const realPromptDeliveryOps: PromptDeliveryOps = {
  deliverHosted: (target, worktree, prompt, defer) => deliverHosted(target, worktree, prompt, defer),
}

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
    const keys = sessions
      .filter((session) => (ownsBase && session.key === baseKey) || session.key.startsWith(`${baseKey}::`))
      .map((session) => session.key)
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

  // Learn the user's language from the first prompt of a NEW task, so text
  // Rove injects later — when no user message is in hand (a quota resume
  // fired by a timer) — comes out in the language they actually write.
  // Scoped to task creation: a follow-up `send` is a different question
  // (which of several tabs, whose text) and is not answered here.
  //
  // Best-effort: an observation must never block the prompt it came from.
  if (target.newTask) {
    await client.request("task.observeLanguage", { taskId: target.id, text: prompt }).catch(() => {})
  }

  // The deferral sink hands a composer-busy prompt to daemon ownership
  // (issue #78 B-layer): the daemon stores the text and queues an inbox
  // episode, and this send reports accepted-but-deferred. The distinct verb
  // is the rolling-upgrade guard: an old replace-on-file daemon rejects it,
  // so the caller fails instead of losing the prompt it previously accepted.
  const defer: PromptDeferralSink = {
    defer: async (info) => {
      const result = await client.request<unknown>("deferredPrompt.fileIfVacant", info)
      if (!result || typeof result !== "object" || Array.isArray(result) || !("kind" in result) || !("id" in result)) {
        throw new Error("invalid deferredPrompt.fileIfVacant response")
      }
      const { kind, id } = result
      if ((kind !== "filed" && kind !== "occupied") || typeof id !== "string" || id.length === 0) {
        throw new Error("invalid deferredPrompt.fileIfVacant response")
      }
      return { kind, id }
    },
  }
  const hosted = await ops.deliverHosted(target, worktree, prompt, defer)
  if (!hosted) throw new ApiError(`failed to start hosted engine session for ${target.id}`, "SESSION_FAILED")
  return hosted
}

export const defaultApiRuntime: ApiRuntime = {
  isTaskRunning: async (taskId) => (await defaultApiRuntime.taskTabs(taskId)).running,
  taskTabs: async (taskId) => {
    // No host = no sessions, an honest "nothing alive"; the persisted tabs
    // still return so a stopped task's layout stays inspectable.
    let sessions: readonly (TaskSessionRow & { pid?: number | null })[] = []
    const host = await openPtyHost()
    if (host) {
      try {
        sessions = await listSessions(host.rpc)
      } finally {
        host.close()
      }
    }
    // Live foreground-walk verdicts per session (issue #33): ONE ps snapshot,
    // the same shallowest-engine walk inspect/live-engine run — so get-task's
    // `liveVendor` reflects what runs NOW, not what a mounted TUI last
    // recorded. Best-effort: a failed ps just keeps the recorded values.
    let liveVendors: Map<string, string | null> | undefined
    try {
      const { foregroundEngineIn, parsePsSnapshot, psSnapshot } = await import("../../engine/foreground.ts")
      const walkable = sessions.filter((s) => s.alive && typeof s.pid === "number" && s.pid > 0)
      if (walkable.length > 0) {
        const rows = parsePsSnapshot(await psSnapshot())
        liveVendors = new Map(walkable.map((s) => [s.key, foregroundEngineIn(rows, s.pid as number)?.vendor ?? null]))
      }
    } catch {
      /* recorded liveVendor stays */
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
    return {
      tabs: joinTaskTabs(snapshot, taskId, sessions, exits, liveVendors),
      running: hasLiveEngineTab(snapshot, taskId, sessions),
    }
  },
  closeTerminalTab: closeHeadlessTerminalTab,
  deliverPrompt: (client, target, prompt) => deliverPrompt(client, target, prompt),
  resolveRepoRoot: async (absPath) => (await import("../../state/repos.ts")).resolveMainRepoRoot(absPath),
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
