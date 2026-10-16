/**
 * Headless tabs that run something Rove resolves itself (`rove api tab-new --kind editor|pane|viewport`):
 * the file tree's editor tab, a plugin pane, and a viewport onto another task's session. None takes a
 * command line from the caller: the editor comes from the user's own Settings, a pane from a registered
 * plugin's manifest, and a viewport runs nothing at all.
 *
 * Rows are written as `tab-new` writes them (`allocateTab`, before the spawn) and broadcast by the caller
 * over `terminalTab.add`, so an attached TUI absorbs them (`absorbTab`).
 */

import { realpathSync, statSync } from "node:fs"
import { join } from "node:path"
import { defaultDaemonSocketPath } from "@sma1lboy/rove-daemon/daemon/paths"
import type { PtyOpenResult } from "@sma1lboy/rove-daemon/daemon/protocol"
import { pathWithin } from "@sma1lboy/rove-daemon/path-identity"
import { type PaneLaunch, listPaneLaunches } from "@sma1lboy/rove-daemon/plugins/pane-command"
import { ROVE_PRODUCT_NAME } from "../../product.ts"
import { resolveEditorLaunch } from "../../tui/lib/editor-launch.ts"
import { readPersistedTerminalDefaultColors } from "../../tui/lib/terminal-colors.ts"
import { type TerminalTab, findEditorTab } from "../../tui/workspace/terminal-tabs-core.ts"
import { listSessions } from "./pty-delivery.ts"
import { ensureHostFor, sessionFailed } from "./session-failed.ts"
import { collision, createdFresh, hostTabIds } from "./tab-new.ts"
import { allocateTab, closeTabsSnapshot, readTabsSnapshot } from "./tab-snapshot.ts"
import type { SplitOutcome } from "./tab-split.ts"
import { ApiError } from "./types.ts"

export type LaunchSpec =
  | { readonly kind: "editor"; readonly taskId: string; readonly worktree: string; readonly file: string }
  | {
      readonly kind: "pane"
      readonly taskId: string
      readonly worktree: string
      /** `<plugin id>.<pane id>`, as `plugin.panes` lists it. */
      readonly pane: string
      /** The tab to split; absent = the task's active tab. */
      readonly hostTab?: string
    }
  | {
      readonly kind: "viewport"
      readonly taskId: string
      /** The task whose first engine session the new tab shows. */
      readonly view: { readonly id: string; readonly worktree: string }
    }

export interface Launched {
  /** The row to broadcast over `terminalTab.add` (a split pane's host tab, or the new tab). */
  readonly tab: TerminalTab
  /** The pty-host key the tab (or pane) runs under. */
  readonly session: string
  /** The split pane a plugin pane opened in, when it split instead of opening a tab. */
  readonly leaf?: string
  /** An editor tab this launch replaced: the caller closes it once the new one is up. */
  readonly replaces?: string
}

/** Splits a tab for a pane; the runtime's `splitTab` (a seam for tests). */
export type SplitPane = (taskId: string, tabId: string, worktree: string, pane: PaneLaunch) => Promise<SplitOutcome>

/** The file as a canonical path inside the worktree: no `..`, no symlink out, a regular file. */
export function fileInside(worktree: string, rel: string): string {
  if (!rel || rel.startsWith("/") || rel.includes("\0") || rel.split(/[\\/]/).includes("..")) {
    throw new ApiError("--file must be a path relative to the worktree", "BAD_FLAG")
  }
  let abs: string
  let root: string
  try {
    root = realpathSync(worktree)
    abs = realpathSync(join(worktree, rel))
  } catch {
    throw new ApiError(`${rel} does not exist in the worktree`, "FILE_NOT_FOUND")
  }
  if (!pathWithin(root, abs)) throw new ApiError(`${rel} resolves outside the worktree`, "BAD_FLAG")
  if (!statSync(abs).isFile()) throw new ApiError(`${rel} is not a file`, "BAD_FLAG")
  return abs
}

/** A new command tab running `command` in `cwd`, row first, spawn second; a refused spawn takes the row back. */
async function spawnCommandTab(
  taskId: string,
  cwd: string,
  command: readonly string[],
  title: string,
  purpose: "editor" | undefined,
  retryArgs: readonly string[],
): Promise<Launched> {
  const host = await ensureHostFor(
    taskId,
    "no PTY host to run the tab in — nothing was started; check `rove daemon status`, then retry",
  )
  try {
    const taken = hostTabIds(await listSessions(host.rpc), taskId)
    const tab = allocateTab(
      taskId,
      (id, ordinal) => ({ kind: "command", id, title, ordinal, command, ...(purpose ? { purpose } : {}) }),
      taken,
    )
    const key = `${taskId}::${tab.id}`
    try {
      let open: PtyOpenResult
      try {
        open = await host.rpc.request<PtyOpenResult>("pty.open", {
          key,
          cwd,
          command,
          defaultColors: readPersistedTerminalDefaultColors(),
        })
      } catch (error) {
        closeTabsSnapshot(taskId, tab.id)
        throw error
      }
      if (!createdFresh(open)) throw collision(taskId, key, retryArgs)
    } finally {
      await host.rpc.request("pty.detach", { key }).catch(() => {})
    }
    return { tab: readTabsSnapshot(taskId)?.tabs.find((t) => t.id === tab.id) ?? tab, session: key }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw sessionFailed(
      taskId,
      `opening the tab failed for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      "the PTY host or state.json refused the new tab — check `rove daemon status` and that state.json is writable, then retry",
    )
  } finally {
    host.close()
  }
}

async function launchEditor(spec: Extract<LaunchSpec, { kind: "editor" }>): Promise<Launched> {
  const abs = fileInside(spec.worktree, spec.file)
  const launch = await resolveEditorLaunch(spec.worktree, abs)
  if (!launch) {
    throw new ApiError("no editor found — set $VISUAL/$EDITOR, or Settings → General → Editor", "NO_EDITOR", {
      hint: "an editor chosen in Settings wins over $EDITOR; `rove config` shows what resolves",
    })
  }
  // The TUI keeps one editor slot per task; the old one goes only after the new one is up.
  const snapshot = readTabsSnapshot(spec.taskId)
  const previous = snapshot ? findEditorTab(snapshot)?.id : undefined
  const opened = await spawnCommandTab(
    spec.taskId,
    spec.worktree,
    ["sh", "-c", launch.command],
    launch.label,
    "editor",
    ["api", "tab-new", "--task-id", spec.taskId, "--kind", "editor", `--file=${spec.file}`],
  )
  return previous ? { ...opened, replaces: previous } : opened
}

/** The plugin pane the caller named, from the registry on this machine. */
export function findPane(taskId: string, pane: string): PaneLaunch {
  const launches = listPaneLaunches({ socketPath: defaultDaemonSocketPath(), binPath: ROVE_PRODUCT_NAME, taskId })
  const found = launches.find((p) => `${p.pluginId}.${p.paneId}` === pane)
  if (!found) {
    throw new ApiError(`no enabled plugin pane named ${pane}`, "PANE_NOT_FOUND", {
      hint: "panes of enabled plugins only; `rove plugin list` shows what is installed",
    })
  }
  return found
}

/** A `split` pane joins a terminal tab's split group; a `tab` pane, or one the tab can't take, opens its own tab. */
async function launchPane(spec: Extract<LaunchSpec, { kind: "pane" }>, split: SplitPane): Promise<Launched> {
  const pane = findPane(spec.taskId, spec.pane)
  const snapshot = readTabsSnapshot(spec.taskId)
  const host = snapshot?.tabs.find((t) => t.id === (spec.hostTab ?? snapshot.activeId))
  if (pane.placement === "split" && host && host.kind !== "content") {
    const out = await split(spec.taskId, host.id, spec.worktree, pane)
    if (out.changed) return { tab: out.tab, session: `${spec.taskId}::${host.id}::${out.leaf}`, leaf: out.leaf }
  }
  return spawnCommandTab(spec.taskId, spec.worktree, pane.argv, pane.title, undefined, [
    "api",
    "tab-new",
    "--task-id",
    spec.taskId,
    "--kind",
    "pane",
    `--pane=${spec.pane}`,
  ])
}

/**
 * A viewport tab (`EngineTab.ptyTask`): the kanban `projectWorktree` placement shows the story's
 * worktree session inside the project workspace. Nothing is spawned; the session already runs.
 */
function launchViewport(spec: Extract<LaunchSpec, { kind: "viewport" }>): Launched {
  const shown = readTabsSnapshot(spec.view.id)?.tabs.find((t) => t.id === "tab-1")
  const engine = shown?.kind === "engine" ? shown : undefined
  const tab = allocateTab(spec.taskId, (id, ordinal) => ({
    kind: "engine",
    id,
    title: null,
    ordinal,
    ...(engine?.vendor ? { vendor: engine.vendor } : {}),
    sessionId: engine?.sessionId ?? null,
    // The session is already running; a spawn would start a second engine under the viewed key.
    spawned: true,
    ptyTask: { id: spec.view.id, worktree: spec.view.worktree },
  }))
  return { tab, session: `${spec.view.id}::tab-1` }
}

export function launchTab(spec: LaunchSpec, split: SplitPane): Promise<Launched> {
  switch (spec.kind) {
    case "editor":
      return launchEditor(spec)
    case "pane":
      return launchPane(spec, split)
    case "viewport":
      return Promise.resolve(launchViewport(spec))
  }
}
