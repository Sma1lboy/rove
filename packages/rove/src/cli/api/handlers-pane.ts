/**
 * `rove api pane-open` — open a terminal pane in a task's workspace over the
 * daemon's `tab.open` channel (same wire as `rove plugin pane open`). The
 * attached TUI performs the split/tab; the daemon only validates + broadcasts.
 */

import { resolveLoginShell } from "@sma1lboy/rove-daemon/daemon/platform-shell"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { taskCwd } from "../../orchestrator/task-tree.ts"
import { resolvePreferredVendor } from "../../state/vendor-prefs.ts"
import type { VendorId } from "../../types/vendor.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { failSharedChild, spawnSharedChild } from "./handlers-spawn.ts"
import { resolveActiveTaskId } from "./runtime.ts"
import { wireSplit } from "./split-wire.ts"
import type { LaunchSpec } from "./tab-launch.ts"
import type { NewTabKind } from "./tab-new.ts"
import type { SplitEdit } from "./tab-split.ts"
import { ApiError, type VerbContext, type VerbSpec, helpStep } from "./types.ts"

export const PANE_VERB: VerbSpec = {
  name: "pane-open",
  group: "drive",
  summary:
    "Open a terminal pane in a task's workspace: split the focused tab (default, or --tab's tab) or open a separate command tab, optionally running a command. Broadcast over the daemon's tab.open channel — an attached TUI showing the task performs the split. Task defaults to $ROVE_TASK_ID, then the active task. Returns the resolved `title` (the label `pane-close --title` must match — derived from the command's first word when --title is omitted) plus `clients` (attached connections, the caller included) and `reached` (false = no front-end subscribes to the channel, so nobody performed the split).",
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
    // `startup.ts` mirrors ROVE_* onto ROVE_* at the CLI boundary, so
    // this also honours $ROVE_TASK_ID.
    const taskId = ctx.args.str("task-id") ?? process.env.ROVE_TASK_ID ?? (await resolveActiveTaskId(client))
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
    "Close panes opened by pane-open: every split pane / command tab in the task whose label matches --title. Broadcast over the daemon's tab.close channel — an attached TUI showing the task performs the close (headless no-op). Task defaults to $ROVE_TASK_ID, then the active task. Returns `clients` (attached connections, the caller included) and `reached` (false = nobody performed the close).",
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
    const taskId = ctx.args.str("task-id") ?? process.env.ROVE_TASK_ID ?? (await resolveActiveTaskId(client))
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
    const daemon = daemonOf(ctx)
    // Still asked first: a mounted TUI kills the PTY and runs its own close flow.
    const reply = await daemon.request<{ handled?: boolean }>("terminalTab.close", { taskId, tabId })
    if (reply.handled) return { ok: true, taskId, tabId, handledBy: "tui" }
    const result = await ctx.runtime.closeTerminalTab(daemon, taskId, tabId)
    return { ok: true, taskId, tabId, handledBy: "headless", ...result }
  },
}

type TabNewKind = NewTabKind | LaunchSpec["kind"]

/** `editor` / `pane` / `viewport`: tabs whose command Rove resolves itself (see `tab-launch.ts`). */
async function launchKind(ctx: VerbContext, daemon: DaemonRpc, task: SerializedTask, kind: LaunchSpec["kind"]) {
  const taskId = task.id
  const worktree = taskCwd(task)
  if (!worktree) throw new ApiError(`task ${taskId} has no worktree yet`, "NO_WORKTREE")
  let spec: LaunchSpec
  if (kind === "editor") {
    const line = ctx.args.int("line")
    spec = { kind, taskId, worktree, file: ctx.args.require("file"), ...(line === undefined ? {} : { line }) }
  } else if (kind === "pane") {
    spec = { kind, taskId, worktree, pane: ctx.args.require("pane"), hostTab: ctx.args.str("tab") }
  } else {
    const viewId = ctx.args.require("view-task")
    if (viewId === taskId) throw new ApiError("--view-task must name another task", "BAD_FLAG", helpStep("tab-new"))
    const { task: shown } = await daemon.request<{ task: SerializedTask }>("task.get", { taskId: viewId })
    if (!shown.worktreePath) throw new ApiError(`task ${viewId} has no worktree yet`, "NO_WORKTREE")
    if (shown.repo !== task.repo) {
      throw new ApiError("--view-task must be a task of the same project", "BAD_FLAG", helpStep("tab-new"))
    }
    spec = { kind, taskId, view: { id: viewId, worktree: shown.worktreePath } }
  }
  const launched = await ctx.runtime.launchTab(daemon, spec)
  // The daemon already holds the row (and published it on `tabs.changed`); this announces it on `tab.add`.
  const reply = await daemon.request<{ clients?: number }>("terminalTab.add", { taskId, tab: launched.tab })
  if (launched.replaces) {
    // The TUI's close path when one is attached, else the headless one (as `tab-close`).
    const closed = await daemon.request<{ handled?: boolean }>("terminalTab.close", {
      taskId,
      tabId: launched.replaces,
    })
    if (!closed.handled) await ctx.runtime.closeTerminalTab(daemon, taskId, launched.replaces)
  }
  return {
    ok: true,
    taskId,
    tabId: launched.tab.id,
    session: launched.session,
    kind,
    ...(launched.leaf ? { leaf: launched.leaf } : {}),
    ...(launched.atLine === undefined ? {} : { atLine: launched.atLine }),
    clients: reply.clients ?? 0,
  }
}

export const TAB_NEW_VERB: VerbSpec = {
  name: "tab-new",
  group: "drive",
  summary:
    "Open a new Terminal Tab with no first message: a login `shell`, or an `engine` conversation that starts idle (the TUI's sidebar \"New shell\" and picker Enter). An `engine` is a new shared child task of --task-id (same directory; the reply carries `childTaskId`) whose engine starts in its own `tab-1`, never a second engine tab on the parent; it respects engine.maxLiveSessions. Unlike `send --tab new` it needs no prompt. A `shell` allocates the tab id, writes the persisted tab row, and spawns the session in the task's worktree (creating it if needed). Three more kinds run something Rove resolves itself, never a command line from the caller: `editor` opens `--file` (relative to the worktree, at `--line` when given) in the editor from Settings → General → Editor / $VISUAL / $EDITOR, in the task's one editor slot (a previous editor tab is closed once the new one is up); `pane` opens a registered plugin pane (`--pane <plugin>.<pane>`), split into `--tab` (default: the active tab) or as its own tab as the pane's manifest says; `viewport` adds a tab onto another task's first engine session (`--view-task`, same project) without starting anything. Broadcast over the daemon's tab.add channel so an attached TUI absorbs the row (`clients` = attached connections; a `shell` and the non-engine kinds only). Returns the new `tabId` and its pty `session` key; the tab then lists in get-task .tabs[].",
  flags: [
    F.taskId(true),
    {
      name: "kind",
      type: "enum",
      values: ["shell", "engine", "editor", "pane", "viewport"],
      required: true,
      placeholder: "KIND",
      description:
        "`shell` = the user's login shell; `engine` = an idle engine in a new shared child task; `editor` = a file in the user's editor; `pane` = a plugin pane; `viewport` = another task's engine session.",
    },
    {
      name: "command",
      type: "string",
      placeholder: "CMD",
      description:
        "Engine only: run the new child task on this engine (an engine id from `engine-list` or a full command line), as `send --tab new --command` does. Omitted = the task's own engine.",
    },
    {
      name: "latest",
      type: "bool",
      description:
        "Engine tabs only: open on the engine this project used last (the TUI's ctrl+t), else the default engine, instead of the task's own. Ignored beside `--command`.",
    },
    {
      name: "file",
      type: "string",
      placeholder: "PATH",
      description: "Editor tabs only: the file to open, relative to the task's worktree.",
    },
    {
      name: "line",
      type: "int",
      placeholder: "N",
      description:
        "Editor tabs only: open at this line. `atLine: false` in the result means the editor takes no line argument Rove knows; add `{line}` to editor.customCommand.",
    },
    {
      name: "pane",
      type: "string",
      placeholder: "ID",
      description: "Pane tabs only: `<plugin id>.<pane id>` of an enabled plugin's pane.",
    },
    {
      name: "tab",
      type: "string",
      placeholder: "TAB",
      description: "Pane tabs only: the tab a split pane joins (e.g. tab-3); default the task's active tab.",
    },
    {
      name: "view-task",
      type: "string",
      placeholder: "ID",
      description: "Viewport tabs only: the task (same project) whose first engine session the tab shows.",
    },
  ],
  handler: async (ctx) => {
    const daemon = daemonOf(ctx)
    const taskId = ctx.args.require("task-id")
    const kind = ctx.args.requireEnum<TabNewKind>("kind")
    const latest = ctx.args.bool("latest") === true
    if (ctx.args.str("line") !== undefined && kind !== "editor") {
      throw new ApiError("--line only applies to an editor tab; pass --kind editor", "BAD_FLAG", helpStep("tab-new"))
    }
    if ((ctx.args.str("command") || latest) && kind !== "engine") {
      throw new ApiError(
        "--command and --latest only apply to an engine tab; pass --kind engine",
        "BAD_FLAG",
        helpStep("tab-new"),
      )
    }
    const { task } = await daemon.request<{ task: SerializedTask }>("task.get", { taskId })
    // The project's last engine; the task's own when it is the same, so its model and effort carry over.
    const preferred = latest ? resolvePreferredVendor(task.repo) : undefined
    const command = ctx.args.str("command") || (preferred && preferred !== task.vendor ? preferred : undefined)
    if (kind === "editor" || kind === "pane" || kind === "viewport") return launchKind(ctx, daemon, task, kind)
    // A second conversation is a shared child task, started idle in its own `tab-1`.
    if (kind === "engine") {
      const child = await spawnSharedChild(daemon, taskId, command)
      try {
        const opened = await ctx.runtime.openTab(
          daemon,
          {
            id: child.id,
            worktreePath: taskCwd(child),
            kind: child.kind,
            vendor: child.vendor as VendorId | undefined,
            command: child.command,
            repo: child.repo,
          },
          kind,
        )
        return { ok: true, taskId, childTaskId: child.id, tabId: opened.tab.id, session: opened.session, kind }
      } catch (err) {
        return failSharedChild(daemon, err, child.id, [
          "api",
          "tab-new",
          "--task-id",
          taskId,
          "--kind",
          "engine",
          ...(command ? ["--command", command] : []),
        ])
      }
    }
    const opened = await ctx.runtime.openTab(
      daemon,
      {
        id: taskId,
        worktreePath: taskCwd(task),
        kind: task.kind,
        vendor: task.vendor as VendorId | undefined,
        command: task.command,
        repo: task.repo,
      },
      kind,
    )
    // The daemon already holds the row (and published it on `tabs.changed`); this announces it on `tab.add`.
    const reply = await daemon.request<{ clients?: number }>("terminalTab.add", { taskId, tab: opened.tab })
    return { ok: true, taskId, tabId: opened.tab.id, session: opened.session, kind, clients: reply.clients ?? 0 }
  },
}

export const TAB_SPLIT_VERB: VerbSpec = {
  name: "tab-split",
  group: "drive",
  summary:
    "Edit one Terminal Tab's split panes without a TUI: `open` splits a pane (the TUI's ctrl+\\ right / ctrl+= down) into a new login shell in the task's worktree, `close` ends a pane, `rename` names it (F2), `reset` kills a shell pane and spawns a fresh one (F5; engine panes refuse). The layout is the tab's persisted split tree and each pane beyond `leaf-1` is its own hosted session `<taskId>::<tabId>::<leaf>`, so an attached TUI absorbs the new row over tab.add and a later `tab-close` sweeps the panes. The shell is always the login shell: no command line is taken. Returns the pane acted on, whether the tree changed (`false` when the pane is too small to split), and the tab's `split` layout (null once back to one pane).",
  flags: [
    F.taskId(true),
    {
      name: "tab",
      type: "string",
      required: true,
      placeholder: "TAB",
      description: "Exact Terminal Tab id from get-task .tabs[].id (for example tab-2).",
    },
    {
      name: "action",
      type: "enum",
      values: ["open", "close", "rename", "reset"],
      required: true,
      placeholder: "ACTION",
      description: "`open` a new pane, `close` one, `rename` one, or `reset` a shell pane.",
    },
    {
      name: "direction",
      type: "enum",
      values: ["right", "down"],
      default: "right",
      description: "`open` only: split toward the right (side by side) or down (stacked).",
    },
    {
      name: "leaf",
      type: "string",
      placeholder: "LEAF",
      description:
        "The pane to act on (`leaf-1` is the tab's own process); for `open`, the pane being split. Default: the tree's active pane.",
    },
    {
      name: "title",
      type: "string",
      placeholder: "TEXT",
      description: "`rename` only: the pane's name; empty clears it back to the default.",
    },
    {
      name: "cols",
      type: "int",
      placeholder: "N",
      description:
        "Cells wide of the pane acted on; with --rows, `open` refuses a split that would leave a pane under 20x6.",
    },
    { name: "rows", type: "int", placeholder: "N", description: "Cells high of the pane acted on (see --cols)." },
  ],
  handler: async (ctx) => {
    const daemon = daemonOf(ctx)
    const taskId = ctx.args.require("task-id")
    const tabId = ctx.args.require("tab")
    const action = ctx.args.requireEnum<"open" | "close" | "rename" | "reset">("action")
    const { task } = await daemon.request<{ task: SerializedTask }>("task.get", { taskId })
    if (!task.worktreePath) throw new ApiError(`task ${taskId} has no worktree yet`, "NO_WORKTREE")
    const cols = ctx.args.int("cols")
    const rows = ctx.args.int("rows")
    if ((cols === undefined) !== (rows === undefined)) {
      throw new ApiError("--cols and --rows go together", "BAD_FLAG", helpStep("tab-split"))
    }
    const size = cols !== undefined && rows !== undefined ? { cols, rows } : undefined
    const leaf = ctx.args.str("leaf") ?? ""
    if (action !== "open" && !leaf)
      throw new ApiError(`--leaf is required to ${action}`, "BAD_FLAG", helpStep("tab-split"))
    const edit: SplitEdit =
      action === "open"
        ? { kind: "open", orientation: ctx.args.str("direction") === "down" ? "column" : "row", from: leaf, size }
        : action === "rename"
          ? { kind: "rename", leaf, title: ctx.args.str("title") ?? "" }
          : action === "reset"
            ? { kind: "reset", leaf, size }
            : { kind: "close", leaf }
    const out = await ctx.runtime.splitTab(daemon, taskId, tabId, taskCwd(task), edit)
    // The daemon already holds the tree (and published it on `tabs.changed`); this announces it on `tab.add`.
    const reply = out.changed
      ? await daemon.request<{ clients?: number }>("terminalTab.add", { taskId, tab: out.tab })
      : {}
    return {
      ok: true,
      taskId,
      tabId,
      leaf: out.leaf,
      changed: out.changed,
      split: wireSplit(out.tab.splitTree),
      clients: reply.clients ?? 0,
    }
  },
}
