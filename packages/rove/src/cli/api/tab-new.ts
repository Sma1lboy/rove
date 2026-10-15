/**
 * Headless "new tab, no first message" (`rove api tab-new`): the plain shell
 * and the empty engine tab the TUI opens from its sidebar and picker.
 *
 * The row is written BEFORE the spawn, in the same locked update that picks
 * its id (`allocateTab`), so the pty key `<taskId>::<tabId>` is reserved the
 * moment anything can see it. A refused or failed spawn takes the row back.
 */

import { resolveLoginShell } from "@sma1lboy/rove-daemon/daemon/platform-shell"
import type { PtyOpenResult } from "@sma1lboy/rove-daemon/daemon/protocol"
import { engineLaunchArgv, withPinnedSessionId } from "../../engine/engine-presets.ts"
import type { HostedSessionRpc } from "../../engine/hosted-session.ts"
import { buildEngineSessionLaunch } from "../../engine/session-launch.ts"
import { trustEngineWorktree } from "../../engine/trust-worktree.ts"
import { persistedMaxLiveEngines } from "../../state/engine-limit.ts"
import { readPersistedTerminalDefaultColors } from "../../tui/lib/terminal-colors.ts"
import { shellIdentityInput } from "../../tui/workspace/terminal-tab-spawn.ts"
import type { TerminalTab } from "../../tui/workspace/terminal-tabs-core.ts"
import { openAdmittedEngine } from "./engine-admission.ts"
import { listSessions } from "./pty-delivery.ts"
import { ensureHostFor, sessionFailed } from "./session-failed.ts"
import { allocateTab, closeTabsSnapshot, markCliTabSession, readTabsSnapshot } from "./tab-snapshot.ts"
import { ApiError, type PromptTarget } from "./types.ts"

export type NewTabKind = "shell" | "engine"

export interface OpenedTab {
  /** The persisted row, as an attached TUI should hold it. */
  readonly tab: TerminalTab
  /** The pty-host key, `<taskId>::<tabId>`. */
  readonly session: string
}

/** Tab ids the host holds for `taskId`, dead ones too: a corpse still pins its key (open ignores a new spec for it). */
function hostTabIds(sessions: readonly { readonly key: string }[], taskId: string): Set<string> {
  const ids = new Set<string>()
  for (const { key } of sessions) {
    const [task, tab, ...rest] = key.split("::")
    if (task === taskId && tab && rest.length === 0) ids.add(tab)
  }
  return ids
}

/** `open` attached to a session this call did not create. The row stays: the key's owner may be a real tab. */
function collision(taskId: string, key: string, retryArgs: readonly string[]): ApiError {
  return new ApiError(`session ${key} already existed; no new tab was created`, "TAB_COLLISION", {
    taskId,
    hint: "another process took this tab id between allocation and spawn; retry to get a fresh id",
    nextCommandArgs: retryArgs,
  })
}

const createdFresh = (open: PtyOpenResult): boolean => open.created ?? open.replay.length === 0

async function openShell(rpc: HostedSessionRpc, taskId: string, cwd: string, taken: ReadonlySet<string>) {
  const shell = resolveLoginShell({ fallback: "/bin/zsh" })
  const tab = allocateTab(
    taskId,
    (id, ordinal) => ({ kind: "command", id, title: null, ordinal, command: [shell] }),
    taken,
  )
  const key = `${taskId}::${tab.id}`
  try {
    let open: PtyOpenResult
    try {
      open = await rpc.request<PtyOpenResult>("pty.open", {
        key,
        cwd,
        command: [shell],
        defaultColors: readPersistedTerminalDefaultColors(),
      })
    } catch (error) {
      closeTabsSnapshot(taskId, tab.id)
      throw error
    }
    if (!createdFresh(open)) throw collision(taskId, key, ["api", "tab-new", "--task-id", taskId, "--kind", "shell"])
    // The TUI types this once, on the spawn it creates; a mounted tab attaching later sees `created: false`.
    await rpc.request("pty.write", { key, data: shellIdentityInput(taskId, tab.id) })
  } finally {
    await rpc.request("pty.detach", { key }).catch(() => {})
  }
  return { tab, key }
}

async function openEngine(rpc: HostedSessionRpc, target: PromptTarget, cwd: string, taken: ReadonlySet<string>) {
  const taskId = target.id
  const tab = allocateTab(
    taskId,
    (id, ordinal) => ({
      kind: "engine",
      id,
      title: null,
      ordinal,
      // Pinned to a non-default engine, as `send --tab new --command` records it.
      ...(target.tabVendor ? { vendor: target.tabVendor } : {}),
      ...(target.tabCommand ? { engineCommand: target.tabCommand } : {}),
    }),
    taken,
  )
  const key = `${taskId}::${tab.id}`
  const retryArgs = [
    "api",
    "tab-new",
    "--task-id",
    taskId,
    "--kind",
    "engine",
    ...(target.tabCommand ? ["--command", target.tabCommand] : []),
  ]
  try {
    let open: PtyOpenResult
    let sessionId: string | null
    try {
      const launchVendor = target.tabVendor ?? target.vendor
      const launchCommand = target.tabCommand ?? (target.tabVendor ? undefined : target.command)
      // Pin the conversation id up front (same contract as the TUI) so a
      // reattach after a pty-host restart resumes THIS conversation.
      const pinned = withPinnedSessionId(
        engineLaunchArgv({
          command: launchCommand,
          vendor: launchVendor,
          effort: target.modelEffort,
          model: target.model,
        }),
        launchVendor,
      )
      sessionId = pinned.sessionId
      // A hosted session can't answer a trust dialog; no-op for generic protocols.
      trustEngineWorktree(launchVendor, cwd)
      const launch = buildEngineSessionLaunch({
        task: { id: taskId, kind: target.kind, vendor: launchVendor, repo: target.repo },
        worktreePath: cwd,
        shell: resolveLoginShell({ fallback: "/bin/zsh" }),
        argv: pinned.argv,
        promptIntent: { kind: "none" },
        tabId: tab.id,
      })
      open = await openAdmittedEngine(
        rpc,
        { key: launch.key, cwd, command: launch.command, defaultColors: readPersistedTerminalDefaultColors() },
        { maxLiveEngines: persistedMaxLiveEngines(), taskId, retryArgs },
      )
    } catch (error) {
      // Nothing spawned (limit refusal, launch refusal, host error): the row must not linger in the strip.
      closeTabsSnapshot(taskId, tab.id)
      throw error
    }
    if (!createdFresh(open) && open.respawned !== true) throw collision(taskId, key, retryArgs)
    if (!open.alive) {
      throw sessionFailed(
        taskId,
        `the new engine tab ${tab.id} exited as it started`,
        "the session was created but nothing stayed running in it — fix the task's launch command (`api update --command`), then open another tab",
        { session: key },
      )
    }
    markCliTabSession(taskId, tab.id, sessionId)
  } finally {
    await rpc.request("pty.detach", { key }).catch(() => {})
  }
  return { tab, key }
}

/** Allocate, spawn and persist one tab with no first message; the caller broadcasts it. */
export async function openNewTab(target: PromptTarget, worktree: string, kind: NewTabKind): Promise<OpenedTab> {
  const host = await ensureHostFor(
    target.id,
    "no PTY host to run the tab in — nothing was started; check `rove daemon status`, then retry",
  )
  try {
    const taken = hostTabIds(await listSessions(host.rpc), target.id)
    const opened =
      kind === "shell"
        ? await openShell(host.rpc, target.id, worktree, taken)
        : await openEngine(host.rpc, target, worktree, taken)
    // Re-read: markCliTabSession may have added the session id the TUI needs.
    const saved = readTabsSnapshot(target.id)?.tabs.find((t) => t.id === opened.tab.id)
    return { tab: saved ?? opened.tab, session: opened.key }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw sessionFailed(
      target.id,
      `opening a ${kind} tab failed for ${target.id}: ${error instanceof Error ? error.message : String(error)}`,
      "the PTY host or state.json refused the new tab — check `rove daemon status` and that state.json is writable, then retry",
    )
  } finally {
    host.close()
  }
}
