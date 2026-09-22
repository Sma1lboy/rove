/**
 * `rove api pane-open` — open a terminal pane in a task's workspace over the
 * daemon's `tab.open` channel (same wire as `rove plugin pane open`). The
 * attached TUI performs the split/tab; the daemon only validates + broadcasts.
 */

import { resolveLoginShell } from "@sma1lboy/kobe-daemon/daemon/platform-shell"
import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { resolveActiveTaskId } from "./runtime.ts"
import { ApiError, type VerbSpec } from "./types.ts"

export const PANE_VERB: VerbSpec = {
  name: "pane-open",
  group: "drive",
  summary:
    "Open a terminal pane in a task's workspace: split the focused tab (default, or --tab's tab) or open a separate command tab, optionally running a command. Broadcast over the daemon's tab.open channel — an attached TUI showing the task performs the split. Task defaults to $ROVE_TASK_ID, then the active task. Returns the resolved `title` (the label `pane-close --title` must match — derived from the command's first word when --title is omitted) plus `clients` (attached connections; 0 = nobody performed the split).",
  flags: [
    F.taskId(false),
    {
      name: "tab",
      type: "string",
      placeholder: "TAB",
      description: "Host tab for the split (e.g. tab-3) instead of the focused tab (split placement only).",
    },
    {
      name: "command",
      type: "string",
      placeholder: "CMD",
      description:
        "Shell command the pane runs (via the login shell's `-ilc`, so pipes/args and your shell rc's PATH/exports work); the pane closes when it exits. Omit for an interactive shell.",
    },
    {
      name: "direction",
      type: "enum",
      values: ["right", "down"],
      default: "right",
      description: "Split orientation relative to the active pane (split placement only).",
    },
    {
      name: "placement",
      type: "enum",
      values: ["split", "tab"],
      default: "split",
      description: "`split` joins the focused tab's split group; `tab` opens a separate command tab.",
    },
    {
      name: "title",
      type: "string",
      placeholder: "TEXT",
      description: 'Pane label (default: the command\'s first word, else "shell").',
    },
  ],
  handler: async (ctx) => {
    const client = daemonOf(ctx)
    // `rename-compat.ts` mirrors ROVE_* onto KOBE_* at the CLI boundary, so
    // this also honours $ROVE_TASK_ID.
    const taskId = ctx.args.str("task-id") ?? process.env.KOBE_TASK_ID ?? (await resolveActiveTaskId(client))
    if (!taskId) {
      // MISSING_TARGET, not TASK_NOT_FOUND: no id was GIVEN (same as
      // read-output / send / collect).
      throw new ApiError("no target task: pass --task-id (no $ROVE_TASK_ID, no active task)", "MISSING_TARGET")
    }
    const command = ctx.args.str("command")
    // Interactive login shell, as the engine tab (session-launch.ts), so the
    // pane sees the same PATH/exports.
    const shell = resolveLoginShell({ fallback: "/bin/sh" })
    const argv = command ? [shell, "-ilc", command] : [shell, "-il"]
    const title = ctx.args.str("title") ?? (command ? (command.trim().split(/\s+/)[0] ?? "shell") : "shell")
    const tabId = ctx.args.str("tab")
    const reply = (await simpleRpc(ctx, "tab.open", {
      taskId,
      argv,
      title,
      ...(tabId !== undefined ? { tabId } : {}),
      placement: ctx.args.str("placement") ?? "split",
      direction: ctx.args.str("direction") ?? "right",
    })) as Record<string, unknown> | undefined
    // Echo the resolved title: `pane-close --title` must match it.
    return { ...reply, title }
  },
}

export const PANE_CLOSE_VERB: VerbSpec = {
  name: "pane-close",
  group: "drive",
  summary:
    "Close panes opened by pane-open: every split pane / command tab in the task whose label matches --title. Broadcast over the daemon's tab.close channel — an attached TUI showing the task performs the close (headless no-op). Task defaults to $ROVE_TASK_ID, then the active task. Returns `clients` (attached connections; 0 = nobody performed the close).",
  flags: [
    F.taskId(false),
    {
      name: "title",
      type: "string",
      required: true,
      placeholder: "TEXT",
      description: "Pane label to close — the --title the pane was opened with (engine panes are never closed).",
    },
    {
      name: "tab",
      type: "string",
      placeholder: "TAB",
      description: "Scope the title match to one tab (e.g. tab-3) instead of every tab of the task.",
    },
  ],
  handler: async (ctx) => {
    const client = daemonOf(ctx)
    const taskId = ctx.args.str("task-id") ?? process.env.KOBE_TASK_ID ?? (await resolveActiveTaskId(client))
    if (!taskId) {
      // MISSING_TARGET, not TASK_NOT_FOUND: no id was GIVEN.
      throw new ApiError("no target task: pass --task-id (no $ROVE_TASK_ID, no active task)", "MISSING_TARGET")
    }
    const tabId = ctx.args.str("tab")
    return simpleRpc(ctx, "tab.close", {
      taskId,
      title: ctx.args.str("title"),
      ...(tabId !== undefined ? { tabId } : {}),
    })
  },
}

export const TAB_CLOSE_VERB: VerbSpec = {
  name: "tab-close",
  group: "drive",
  summary:
    "Close one Terminal Tab by the id returned in get-task .tabs[]. Runs the same close path as ctrl+w when a TUI is attached; otherwise removes the persisted tab snapshot and ends its hosted PTYs directly. Engine, shell/command, and content tabs are all valid. Closing the last tab leaves the task open with no session.",
  flags: [
    F.taskId(true),
    {
      name: "tab",
      type: "string",
      required: true,
      placeholder: "TAB",
      description: "Exact Terminal Tab id from get-task .tabs[].id (for example tab-3).",
    },
  ],
  handler: async (ctx) => {
    const taskId = ctx.args.require("task-id")
    const tabId = ctx.args.require("tab")
    const reply = await daemonOf(ctx).request<{ handled?: boolean }>("terminalTab.close", { taskId, tabId })
    if (reply.handled) return { ok: true, taskId, tabId, handledBy: "tui" }
    const result = await ctx.runtime.closeTerminalTab(taskId, tabId)
    return { ok: true, taskId, tabId, handledBy: "headless", ...result }
  },
}
