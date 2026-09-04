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
import { deliverToExactTab } from "./exact-tab-delivery.ts"
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
      const tabId = target.tab
      return await deliverToExactTab(host.rpc, target.id, tabId, worktree, prompt, {
        engineBin,
        vendor: target.vendor,
        defer,
        // Only with explicit consent (`send --respawn`). The factory is lazy
        // so the snapshot read happens only on the branch that needs it —
        // reviving a tab a pty-host restart froze.
        ...(target.respawn
          ? {
              respawn: () => restoredTabLaunch(target, tabId, worktree, process.env.SHELL?.trim() || "/bin/zsh"),
            }
          : {}),
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
    // Pre-trust the worktree in the protocol's first-run store —
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
    // the prompt never reached it. `engineReady` does NOT stand in for that —
    // it is an independent readiness observation, and an engine that never
    // announced bracketed paste can still have been written to.
    //
    // The task and its worktree EXIST by now, so the refusal has to name them:
    // an unattended fan-out that only reads the message would otherwise lose
    // the id of a task it just created, and every failed launch in the batch
    // would look identical. `reason` is the session's own last line.
    if (result.started && !result.delivered && !result.deferred) {
      throw new ApiError(`failed to start hosted engine session for ${target.id}`, "SESSION_FAILED", {
        taskId: target.id,
        session: result.session,
        engineReady: result.engineReady,
        ...(result.reason ? { reason: result.reason } : {}),
        hint: "the session was created but no engine ran in it — fix the task's launch command (`api update --command`), then retry with `api send --tab new`",
        nextCommandArgs: ["api", "read-output", "--task-id", target.id, "--source", "terminal"],
      })
    }
    // Make the session visible to the sidebar tree, which lists a worktree's
    // tabs from the task's persisted snapshot. Without this a CLI-started
    // session runs live with no snapshot, so the tree shows the worktree with
    // no tabs under it at all. Write-once (a --tab new spawn already appended its tab
    // in mintCliTab); see `tab-snapshot.ts`. When THIS delivery started the
    // session, record the pinned session id + spawned flag too, so a later
    // dead-reattach resumes the conversation (see engineTabArgv).
    if (!newTab) publishCliTabSnapshot(target.id, result.started ? sessionId : undefined)
    if (result.started && sessionId) {
      // publishCliTabSnapshot is write-ONCE by contract (a mounted TUI owns
      // tab state), so on a task that already has a snapshot it no-ops and
      // the id never lands. That is not a missing field but a WRONG one: a
      // canonical send after a host restart respawns tab-1 under a fresh
      // pinned id while the snapshot still names the previous conversation,
      // so `--resume` would reopen the wrong one. Recording the id of a
      // session THIS process just started is not fighting the TUI — it is
      // the same write `--tab new` already does.
      const startedTab = newTab ?? result.session.split("::")[1]
      if (startedTab) markCliTabSession(target.id, startedTab, sessionId)
    }
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

  // The deferral sink hands a composer-busy prompt to daemon
  // ownership: the daemon stores the text and queues an inbox episode, and
  // this send reports accepted-but-deferred. The distinct verb is the
  // rolling-upgrade guard: a replace-on-file daemon rejects it, so the caller
  // fails instead of losing a prompt it has already accepted.
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
      // `expiresAt` is additive — a daemon predating it just omits the field,
      // and the deferral is still a valid handoff without it.
      const expiresAt = "expiresAt" in result ? result.expiresAt : undefined
      return { kind, id, ...(typeof expiresAt === "string" ? { expiresAt } : {}) }
    },
  }
  const hosted = await ops.deliverHosted(target, worktree, prompt, defer)
  if (!hosted) throw new ApiError(`failed to start hosted engine session for ${target.id}`, "SESSION_FAILED")
  return hosted
}

export const defaultApiRuntime: ApiRuntime = {
  isTaskRunning: async (taskId, engineArgv) => (await defaultApiRuntime.taskTabs(taskId, engineArgv)).running,
  taskTabs: async (taskId, engineArgv) => {
    // No host is "couldn't ask", NOT "nothing alive" — the host idle-exits and
    // it can be merely unreachable while every engine it hosts keeps running.
    // Publishing that as `false` is what would have an unattended cleanup loop
    // delete worktrees holding live work, so it travels as `null` all the way
    // out, the same tri-state `pty-list` already publishes. The persisted tabs
    // still return so a stopped task's layout stays inspectable.
    let listed: readonly (TaskSessionRow & { pid?: number | null })[] | null = null
    const host = await openPtyHost()
    if (host) {
      try {
        // The tri-state listing, NOT `listSessions`: connecting to a stopped
        // host succeeds and only the request fails, so `host !== null` is not
        // evidence anybody answered.
        listed = await listSessionsOrNull(host.rpc)
      } finally {
        host.close()
      }
    }
    const sessions = listed ?? []
    const hostReachable = listed !== null
    // Live per-session walk verdicts: ONE ps snapshot answering two
    // questions — which vendor is in the foreground (`liveVendor`, the same
    // shallowest-engine walk inspect/live-engine run) and whether ANY engine
    // is in the tree at all (`engineAlive`, the predicate delivery gates on).
    // The second is what separates a working engine from the login shell
    // keepAlive leaves in its place, which `alive` cannot see.
    // Best-effort: a failed ps keeps the recorded liveVendor and leaves
    // `engineAlive` unknown rather than guessing it false.
    let liveVendors: Map<string, string | null> | undefined
    let engineAlive: Map<string, boolean> | undefined
    try {
      const { engineProcessIn, foregroundEngineIn, parsePsSnapshot, psSnapshot } = await import(
        "../../engine/foreground.ts"
      )
      const walkable = sessions.filter((s) => s.alive && typeof s.pid === "number" && s.pid > 0)
      if (walkable.length > 0) {
        const rows = parsePsSnapshot(await psSnapshot())
        liveVendors = new Map(walkable.map((s) => [s.key, foregroundEngineIn(rows, s.pid as number)?.vendor ?? null]))
        // `engineArgv` is the task's own launch command: without it a custom
        // engine (a wrapper script no vendor table names) walks as "no
        // engine" and the task reads stopped while it works.
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
    // The pinned conversation id per tab — persisted since engine tabs
    // existed, readable nowhere. It is the whole recovery for a dead engine
    // tab (`claude --resume <id>`), and `send --tab N --respawn` names it in
    // its refusal, so a caller must be able to read it back.
    const sessionIds = new Map(
      (snapshot?.tabs ?? []).map((t) => [t.id, (t as { sessionId?: string | null }).sessionId ?? undefined]),
    )
    return {
      tabs: joinTaskTabs(snapshot, taskId, listed, exits, liveVendors, engineAlive).map((row) => {
        const sessionId = sessionIds.get(row.id)
        return sessionId ? { ...row, sessionId } : row
      }),
      running: hostReachable ? hasLiveEngineTab(snapshot, taskId, sessions, engineAlive) : null,
    }
  },
  closeTerminalTab: closeHeadlessTerminalTab,
  deliverPrompt: (client, target, prompt) => deliverPrompt(client, target, prompt),
  resolveRepoRoot: async (absPath) => (await import("../../state/repos.ts")).resolveMainRepoRoot(absPath),
  isUsableRepo: async (absPath) => {
    const { isGitRepo, isRemoteRepoKey } = await import("../../state/repos.ts")
    return isRemoteRepoKey(absPath) || isGitRepo(absPath)
  },
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
