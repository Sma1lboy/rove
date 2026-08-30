/**
 * The `drive` verb group — sending prompts, notes, panes, and UI notices to
 * tasks. Split out of `verbs.ts` (file-size cap); spread back into the
 * {@link VERBS} table there, so schema/help/validation see one canonical list.
 */

import { F } from "./flags.ts"
import { simpleRpc } from "./handler-helpers.ts"
import { PANE_CLOSE_VERB, PANE_VERB } from "./handlers-pane.ts"
import { DISPATCH_VERB, note, send, setActive } from "./handlers-tasks.ts"
import type { VerbSpec } from "./types.ts"

export const DRIVE_VERBS: readonly VerbSpec[] = [
  {
    name: "send",
    summary:
      "Paste a follow-up prompt into a task's running engine (one full turn). Without --task-id, a task spawned from another Rove session replies to its dispatcher's tab (then that task's live canonical engine; nothing alive = DISPATCHER_UNREACHABLE, never a silent spawn); otherwise the active task. Sent from inside another Rove task ($ROVE_TASK_ID), the prompt is prefixed with [ROVE PEER] provenance — who sent it and how to reply (tab-precise) — so agent-to-agent messaging needs no coordinator. When the target composer is busy (you'd paste into a half-typed message), the prompt is accepted-but-deferred: the daemon stores it and queues a `prompt_deferred` Inbox episode for a human to release — that outcome is a SUCCESS (exit 0, `deferred` in the JSON). Do NOT retry a deferred send: the daemon already owns the message, and resending stacks a duplicate in the queue.",
    flags: [
      F.taskId(false),
      F.prompt(true, "Text pasted + submitted into the engine pane."),
      {
        name: "tab",
        type: "string",
        required: false,
        placeholder: "TAB",
        description:
          'Tab addressing: "new" spawns the prompt in a fresh engine tab; "tab-N" delivers to that exact alive tab (error when dead/absent). Omitted = the canonical engine tab.',
      },
      {
        ...F.command(),
        description:
          "Engine launch command for a `--tab new` tab — the API twin of the TUI's ctrl+e pick. Lets one worktree run two agents on the same files (e.g. hand the stuck work to codex without leaving the branch). An engine id from `engine-list` or a full command line; pinned to that tab, so it survives restarts and a later set-command on the task. Only valid with --tab new.",
      },
      {
        name: "plain",
        type: "bool",
        required: false,
        description: "Deliver the prompt verbatim — skip the [ROVE PEER] provenance prefix.",
      },
    ],
    handler: send,
  },
  DISPATCH_VERB,
  {
    name: "note",
    summary:
      "File a one-line field note — a resolved, repo-level gotcha worth sharing. Appended to the repo's durable note store (every future session on this repo starts with it) and forwarded to the dispatcher session for live relay (docs/design/dispatcher.md).",
    flags: [
      F.taskId(true),
      {
        name: "text",
        type: "string",
        required: true,
        placeholder: "TEXT",
        description: "One line: the verified conclusion another session could act on.",
      },
    ],
    handler: note,
  },
  {
    name: "note-list",
    summary: "Read a repo's accumulated field notes, newest first. Returns { notes }.",
    flags: [F.repo(true)],
    handler: (ctx) => simpleRpc(ctx, "note.list", { repo: ctx.args.requirePath("repo") }),
  },
  PANE_VERB,
  PANE_CLOSE_VERB,
  {
    name: "notify",
    summary:
      "Show a toast in every attached Rove UI — broadcast over the daemon's notice.event channel. Agents/scripts use it to surface 'done / needs input / error' moments without touching the task's session. Returns `clients` (attached connections; 0 = no UI showed the toast).",
    flags: [
      {
        name: "title",
        type: "string",
        required: true,
        placeholder: "TEXT",
        description: "Toast text (one line).",
      },
      {
        name: "kind",
        type: "string",
        default: "done",
        placeholder: "KIND",
        description:
          'Free-form kind tag. "done", "needs_input" and "error" get the TUI\'s severity styling/unread mark; any other value renders neutrally.',
      },
      F.taskId(false),
      {
        name: "source",
        type: "string",
        placeholder: "TAG",
        description: "Free-form origin tag (e.g. an agent name) recorded on the event.",
      },
    ],
    handler: async (ctx) => {
      return simpleRpc(ctx, "notice.send", {
        title: ctx.args.str("title"),
        kind: ctx.args.str("kind") ?? "done",
        taskId: ctx.args.str("task-id"),
        source: ctx.args.str("source"),
      })
    },
  },
  {
    name: "prompt",
    summary:
      "Ask the human for a line of text through the attached TUI's input dialog (plugins' host-provided prompt). Blocks until answered, cancelled, or timed out; returns { value } or { cancelled, reason }.",
    flags: [
      {
        name: "title",
        type: "string",
        required: true,
        placeholder: "TEXT",
        description: "Dialog title (shown verbatim).",
      },
      { name: "placeholder", type: "string", placeholder: "TEXT", description: "Input placeholder." },
      { name: "initial", type: "string", placeholder: "TEXT", description: "Pre-filled input value." },
      {
        name: "timeout",
        type: "string",
        placeholder: "MS",
        description: "Give up after this many milliseconds (default 120000, max 600000).",
      },
    ],
    handler: async (ctx) => {
      const timeoutRaw = ctx.args.str("timeout")
      const timeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : undefined
      return simpleRpc(ctx, "ui.prompt", {
        title: ctx.args.str("title"),
        placeholder: ctx.args.str("placeholder"),
        initial: ctx.args.str("initial"),
        ...(timeoutMs && Number.isFinite(timeoutMs) ? { timeoutMs } : {}),
      })
    },
  },
  {
    name: "engine-report",
    summary:
      "Report a normalized engine-activity verb for a task — the public face of the same engine.reportEvent RPC the built-in hook adapters use. Lets a plugin-contributed engine (or any wrapper script) drive the sidebar badge, attention inbox, and plugin event stream without a built-in hook adapter. Kinds: session-start|turn-start|turn-complete|turn-failed|turn-interrupted|awaiting-input|session-end (state kinds) plus tool-pre|tool-post|tool-failed|pre-compact|post-compact|subagent-start|subagent-stop (plugin-only).",
    flags: [
      F.taskId(false),
      {
        name: "kind",
        type: "string",
        required: true,
        placeholder: "KIND",
        description: "Normalized activity verb (see summary). Unknown kinds are rejected.",
      },
      {
        name: "engine",
        type: "string",
        placeholder: "ID",
        description: "Engine id producing the report (a plugin engine id, or a built-in vendor).",
      },
      {
        name: "tab",
        type: "string",
        placeholder: "TAB",
        description: "Terminal tab id the session runs in (defaults to $ROVE_TAB_ID / $KOBE_TAB_ID).",
      },
      {
        name: "detail",
        type: "string",
        placeholder: "JSON",
        description: 'Optional detail JSON, e.g. \'{"failure":"rate_limit"}\' or \'{"waiting":"input"}\'.',
      },
    ],
    handler: async (ctx) => {
      const taskId = ctx.args.str("task-id") ?? process.env.ROVE_TASK_ID ?? process.env.KOBE_TASK_ID
      const tabId = ctx.args.str("tab") ?? process.env.ROVE_TAB_ID ?? process.env.KOBE_TAB_ID
      const detailRaw = ctx.args.str("detail")
      let detail: unknown
      if (detailRaw !== undefined) {
        try {
          detail = JSON.parse(detailRaw)
        } catch {
          throw new Error("--detail must be valid JSON")
        }
      }
      return simpleRpc(ctx, "engine.reportEvent", {
        kind: ctx.args.str("kind"),
        ...(taskId ? { taskId } : { cwd: process.cwd() }),
        ...(ctx.args.str("engine") ? { engine: ctx.args.str("engine") } : {}),
        ...(tabId ? { tabId } : {}),
        ...(detail !== undefined ? { detail } : {}),
      })
    },
  },
  {
    name: "set-active",
    summary: "Set the shared active task (the focus every Tasks pane highlights). Pass --none to clear.",
    flags: [
      F.taskId(false),
      { name: "none", type: "bool", description: "Clear the active task instead of setting one." },
    ],
    handler: setActive,
  },
]
