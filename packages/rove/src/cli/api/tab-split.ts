/**
 * Headless split-pane edits (`rove api tab-split`): the TUI's ctrl+\ / ctrl+= /
 * ctrl+w / F2 / F5 on a tab's split tree, for clients with no TUI of their own.
 *
 * Same model as `TerminalSplit`: the layout is the tab's persisted `splitTree`
 * (stored through the daemon's `tabs.apply`), every leaf beyond `leaf-1` is its own
 * hosted login shell under `<taskId>::<tabId>::leaf-N`, and a closed tab's
 * teardown already sweeps those keys. The shell is always the login shell: no
 * caller supplies a command line. An attached TUI hears the new row over
 * `tab.add` (`absorbTab` merges the tree).
 */

import { resolveLoginShell } from "@sma1lboy/rove-daemon/daemon/platform-shell"
import type { PtyOpenResult } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { HostedSessionRpc } from "../../engine/hosted-session.ts"
import { readPersistedTerminalDefaultColors } from "../../tui/lib/terminal-colors.ts"
import { initialSplit, leaves, removeLeaf, renameLeaf, splitActive } from "../../tui/workspace/split-core.ts"
import { shellIdentityInput } from "../../tui/workspace/terminal-tab-spawn.ts"
import {
  type PersistedSplit,
  type TabsState,
  type TerminalTab,
  collapseSplit,
  splitLeafPtyKey,
  tabPtyKeyFor,
} from "../../tui/workspace/terminal-tabs-core.ts"
import { killTaskSessions } from "./pty-delivery.ts"
import { ensureHostFor, sessionFailed } from "./session-failed.ts"
import { type TabsRpc, patchTabSplit, readDaemonTabs } from "./tab-snapshot.ts"
import { ApiError } from "./types.ts"

export type SplitEdit =
  /** Split `from` (the leaf with focus) toward `orientation`; `size` is that leaf's cells, for the min-pane gate. */
  | {
      kind: "open"
      orientation: "row" | "column"
      from: string
      size?: { cols: number; rows: number }
      /** A plugin pane's argv and label; omitted = a login shell. */
      command?: { argv: readonly string[]; title: string }
    }
  | { kind: "close"; leaf: string }
  | { kind: "rename"; leaf: string; title: string }
  /** F5: kill the leaf's shell and spawn a fresh login shell in the same worktree. */
  | { kind: "reset"; leaf: string; size?: { cols: number; rows: number } }

export interface SplitOutcome {
  /** The tab row as persisted after the edit. */
  readonly tab: TerminalTab
  /** The leaf the edit created or acted on. */
  readonly leaf: string
  /** False = the tree is unchanged (too small to split, or the leaf was already gone). */
  readonly changed: boolean
}

function tabNotFound(taskId: string, tabId: string): ApiError {
  return new ApiError(`tab ${tabId} does not exist on task ${taskId}`, "TAB_NOT_FOUND", {
    hint: "refresh the task's tab ids with get-task, then retry with one of its .tabs[].id values",
    nextCommandArgs: ["api", "get-task", "--task-id", taskId],
  })
}

function locate(taskId: string, tabId: string, state: TabsState | undefined): { state: TabsState; tab: TerminalTab } {
  const tab = state && Array.isArray(state.tabs) ? state.tabs.find((t) => t.id === tabId) : undefined
  if (!state || !tab) throw tabNotFound(taskId, tabId)
  if (tab.kind === "content") {
    throw new ApiError(`tab ${tabId} is a content tab; only terminal tabs split`, "TAB_NOT_SPLITTABLE")
  }
  return { state, tab }
}

/**
 * Edit the tab's tree as the daemon holds it and store the result as one
 * `patch` of `splitTree` (`tabs.apply`); `edit` returns the next tree, or the
 * same one for a no-op (nothing is sent).
 */
async function editTree(
  client: TabsRpc,
  taskId: string,
  tabId: string,
  edit: (tree: PersistedSplit) => PersistedSplit,
): Promise<{ tab: TerminalTab; before: PersistedSplit; after: PersistedSplit }> {
  const { tab } = locate(taskId, tabId, await readDaemonTabs(client, taskId))
  const before = tab.splitTree ?? initialSplit(null)
  const after = edit(before)
  if (after === before) return { tab, before, after }
  const saved = await patchTabSplit(client, taskId, tabId, collapseSplit(after))
  // Gone in between (another client closed it): the same miss as before the read.
  if (!saved) throw tabNotFound(taskId, tabId)
  return { tab: saved, before, after }
}

async function openLeafShell(
  rpc: HostedSessionRpc,
  key: string,
  cwd: string,
  opts: { size?: { cols: number; rows: number }; identity?: string; command?: readonly string[] } = {},
): Promise<void> {
  await rpc.request<PtyOpenResult>("pty.open", {
    key,
    cwd,
    command: opts.command ?? [resolveLoginShell({ fallback: "/bin/zsh" })],
    defaultColors: readPersistedTerminalDefaultColors(),
    ...(opts.size ? { cols: opts.size.cols, rows: opts.size.rows } : {}),
  })
  // A shell TAB exports its ids once, on the spawn it creates (as `tab-new`).
  if (opts.identity) await rpc.request("pty.write", { key, data: opts.identity })
  await rpc.request("pty.detach", { key }).catch(() => {})
}

export async function splitTab(
  client: TabsRpc,
  taskId: string,
  tabId: string,
  worktree: string,
  edit: SplitEdit,
): Promise<SplitOutcome> {
  const host = await ensureHostFor(
    taskId,
    "no PTY host to run the split in — nothing was changed; check `rove daemon status`",
  )
  try {
    switch (edit.kind) {
      case "open": {
        const { tab, before, after } = await editTree(client, taskId, tabId, (tree) => {
          const from = leaves(tree.root).some((l) => l.id === edit.from) ? edit.from : tree.activeLeafId
          const base = from === tree.activeLeafId ? tree : { ...tree, activeLeafId: from }
          const argv = edit.command?.argv ?? [resolveLoginShell({ fallback: "/bin/zsh" })]
          const next = splitActive(base, edit.orientation, argv, edit.size ?? null)
          if (next === base) return tree
          return edit.command ? renameLeaf(next, next.activeLeafId, edit.command.title) : next
        })
        if (after === before) return { tab, leaf: before.activeLeafId, changed: false }
        const leaf = after.activeLeafId
        try {
          await openLeafShell(host.rpc, splitLeafPtyKey(tabPtyKeyFor(taskId, tab), leaf), worktree, {
            size: edit.size,
            command: edit.command?.argv,
          })
        } catch (error) {
          await editTree(client, taskId, tabId, (tree) => removeLeaf(tree, leaf) ?? tree).catch(() => undefined)
          throw sessionFailed(
            taskId,
            `opening a split shell failed: ${error instanceof Error ? error.message : String(error)}`,
            "the PTY host refused the shell — the split was taken back; check `rove daemon status`, then retry",
          )
        }
        return { tab, leaf, changed: true }
      }
      case "close": {
        const { tab, before, after } = await editTree(client, taskId, tabId, (tree) => {
          const next = removeLeaf(tree, edit.leaf)
          if (next === null) throw new ApiError(`${edit.leaf} is the only pane; close the tab instead`, "LAST_LEAF")
          return next
        })
        if (after === before) return { tab, leaf: edit.leaf, changed: false }
        await killTaskSessions(host.rpc, [splitLeafPtyKey(tabPtyKeyFor(taskId, tab), edit.leaf)])
        return { tab, leaf: edit.leaf, changed: true }
      }
      case "rename": {
        const { tab, before, after } = await editTree(client, taskId, tabId, (tree) =>
          renameLeaf(tree, edit.leaf, edit.title),
        )
        return { tab, leaf: edit.leaf, changed: after !== before }
      }
      case "reset": {
        const { tab } = await editTree(client, taskId, tabId, (tree) => tree)
        const shellTab = tab.kind === "command"
        if (!shellTab && edit.leaf === "leaf-1") {
          throw new ApiError("reset respawns a login shell; this pane runs an engine", "RESET_ENGINE", {
            hint: "close the engine tab and open a new one; shell tabs and split shells reset",
          })
        }
        const key = splitLeafPtyKey(tabPtyKeyFor(taskId, tab), edit.leaf)
        // Wait: the key must be gone before the open, or the dying session pins it.
        await killTaskSessions(host.rpc, [key], { wait: true })
        await openLeafShell(host.rpc, key, worktree, {
          size: edit.size,
          identity: shellTab && edit.leaf === "leaf-1" ? shellIdentityInput(taskId, tab.id) : undefined,
        })
        return { tab, leaf: edit.leaf, changed: false }
      }
    }
  } finally {
    host.close()
  }
}
