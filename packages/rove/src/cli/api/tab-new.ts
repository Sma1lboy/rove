/**
 * Headless "new tab, no first message" (`rove api tab-new`): the plain shell
 * and the empty engine tab the TUI opens from its sidebar and picker.
 *
 * The row is opened BEFORE the spawn, by the daemon that mints its id
 * (`allocateTab` → `tabs.apply`), so the pty key `<taskId>::<tabId>` is
 * reserved the moment anything can see it. A refused or failed spawn takes the
 * row back.
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
import { ensureHostFor, sessionFailed } from "./session-failed.ts"
import { type TabsRpc, allocateTab, closeTabsSnapshot, markCliTabSession } from "./tab-snapshot.ts"
import { ApiError, type PromptTarget } from "./types.ts"

export type NewTabKind = "shell" | "engine"

export interface OpenedTab {
  /** The persisted row, as an attached TUI should hold it. */
  readonly tab: TerminalTab
  /** The pty-host key, `<taskId>::<tabId>`. */
  readonly session: string
}

/**
 * `open` attached to a session this call did not create (a live orphan held
 * the id the daemon minted). The row stays: the key's owner may be a real tab.
 */
export function collision(taskId: string, key: string, retryArgs: readonly string[]): ApiError {
  return new ApiError(`session ${key} already existed; no new tab was created`, "TAB_COLLISION", {
    taskId,
    hint: "a session already held the tab id the daemon minted; retry to get a fresh id",
    nextCommandArgs: retryArgs,
  })
}

export const createdFresh = (open: PtyOpenResult): boolean => open.created ?? open.replay.length === 0

async function openShell(client: TabsRpc, rpc: HostedSessionRpc, taskId: string, cwd: string) {
  const shell = resolveLoginShell({ fallback: "/bin/zsh" })
  const tab = await allocateTab(client, taskId, { kind: "command", title: null, command: [shell] })
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
      await closeTabsSnapshot(client, taskId, tab.id).catch(() => undefined)
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

async function openEngine(client: TabsRpc, rpc: HostedSessionRpc, target: PromptTarget, cwd: string) {
  const taskId = target.id
  let tab: TerminalTab = await allocateTab(client, taskId, {
    kind: "engine",
    title: null,
    // Pinned to a non-default engine, as `send --tab new --command` records it.
    ...(target.tabVendor ? { vendor: target.tabVendor } : {}),
    ...(target.tabCommand ? { engineCommand: target.tabCommand } : {}),
  })
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
      await closeTabsSnapshot(client, taskId, tab.id).catch(() => undefined)
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
    // The row as the daemon holds it now: with the session id the TUI needs.
    const marked = await markCliTabSession(client, taskId, tab.id, sessionId)
    tab = marked?.tabs.find((t) => t.id === tab.id) ?? tab
  } finally {
    await rpc.request("pty.detach", { key }).catch(() => {})
  }
  return { tab, key }
}

/** Allocate, spawn and persist one tab with no first message; the caller broadcasts it. */
export async function openNewTab(
  client: TabsRpc,
  target: PromptTarget,
  worktree: string,
  kind: NewTabKind,
): Promise<OpenedTab> {
  const host = await ensureHostFor(
    target.id,
    "no PTY host to run the tab in — nothing was started; check `rove daemon status`, then retry",
  )
  try {
    const opened =
      kind === "shell"
        ? await openShell(client, host.rpc, target.id, worktree)
        : await openEngine(client, host.rpc, target, worktree)
    return { tab: opened.tab, session: opened.key }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw sessionFailed(
      target.id,
      `opening a ${kind} tab failed for ${target.id}: ${error instanceof Error ? error.message : String(error)}`,
      "the PTY host or the daemon refused the new tab — check `rove daemon status`, then retry",
    )
  } finally {
    host.close()
  }
}
