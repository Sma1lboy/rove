/**
 * Area ops behind the Board, Routines and GitHub Issues pages. Each op wraps one `rove api`
 * verb, daemon RPC or pure Rove helper; sessions started from a story are sequenced by the app
 * from these atoms (`task.create` → `issue.update` → `issue.setStatus`), the same steps the
 * TUI's kanban drawer runs.
 *
 * Deliberately absent: a routine's `--precheck`. It is a shell string the daemon runs before
 * the engine starts; the phone shows it read-only and never authors one.
 */

import type { Issue } from "@sma1lboy/rove-daemon/daemon/issues-store"
import { samePath } from "@sma1lboy/rove-daemon/path-identity"
import type { RecentTaskEvent } from "@sma1lboy/rove/src/client/remote-orchestrator.ts"
import { roveApiInvocation } from "@sma1lboy/rove/src/engine/interactive-command.ts"
import { issueChatTaskTitle, issueProjectPrompt, issueWorktreePrompt } from "@sma1lboy/rove/src/state/issue-chat.ts"
import { detailFragment } from "@sma1lboy/rove/src/tui-react/component/issue-events-core.ts"
import { ALL_VENDORS } from "@sma1lboy/rove/src/types/vendor.ts"
import { BridgeError, optBool, optInt, optStr } from "../protocol.ts"
import { absPath, bool, flag, oneOf, optOneOf, optText, taskId, text } from "./args.ts"
import type { Args, OpTable } from "./types.ts"

const ISSUE_STATUSES = ["open", "doing", "hold", "done"] as const
const TITLE_MAX = 300
const BODY_MAX = 20_000
const NAME_MAX = 120
const PROMPT_MAX = 20_000
/** The drawer shows the tail of the ring, not all 100. */
const EVENT_LIMIT = 12

function issueId(args: Args): number {
  const id = optInt(args, "id", 1, 1_000_000_000)
  if (id === undefined) throw new BridgeError("BAD_ARGS", "id must be an issue number")
  return id
}

/** Five whitespace-separated cron fields of the characters cron uses; the daemon validates meaning. */
function cron(args: Args, name: string): string {
  const v = text(args, name, 120).trim()
  if (!/^[0-9A-Za-z*/,\-?#LW]+(?: [0-9A-Za-z*/,\-?#LW]+){4}$/.test(v)) {
    throw new BridgeError("BAD_ARGS", `${name} must be five space-separated cron fields`)
  }
  return v
}

/** A string that must differ from absent when sent: reject nothing but pass it through `flag`. */
function setIfPresent(argv: string[], name: string, value: string | undefined): void {
  if (value !== undefined) argv.push(flag(name, value))
}

interface TaskListed {
  readonly tasks: readonly {
    readonly id: string
    readonly repo: string
    readonly linkedWorkItem?: { number?: number }
  }[]
}

export const pagesOps: OpTable = {
  // ── issue store (Board) ──────────────────────────────────────────────────────
  "issue.repos": {
    kind: "read",
    destructive: false,
    wraps: "daemon RPC issue.repos",
    run: (_args, { api }) => api.rpc("issue.repos", {}),
  },
  "issue.list": {
    kind: "read",
    destructive: false,
    wraps: "rove api issue-list",
    run: (args, { api }) => api.verb("issue-list", [flag("repo", absPath(args, "repo"))]),
  },
  "issue.create": {
    kind: "write",
    destructive: false,
    wraps: "rove api issue-create",
    run: (args, { api }) => {
      const argv = [flag("repo", absPath(args, "repo")), flag("title", text(args, "title", TITLE_MAX).trim())]
      setIfPresent(argv, "body", optText(args, "body", BODY_MAX))
      return api.verb("issue-create", argv)
    },
  },
  "issue.update": {
    kind: "write",
    destructive: false,
    wraps:
      "rove api issue-update (title/body and/or task link; task=none unlinks; clearBody stores one space, the verb cannot send an empty body)",
    run: (args, { api }) => {
      const title = optText(args, "title", TITLE_MAX)
      const typed = optText(args, "body", BODY_MAX)
      if (optBool(args, "clearBody") && typed !== undefined) {
        throw new BridgeError("BAD_ARGS", "body and clearBody are exclusive")
      }
      const body = optBool(args, "clearBody") ? " " : typed
      const task = optStr(args, "task") === undefined ? undefined : taskId(args, "task")
      if (title === undefined && body === undefined && task === undefined) {
        throw new BridgeError("BAD_ARGS", "issue.update needs title, body and/or task")
      }
      const argv = [flag("repo", absPath(args, "repo")), flag("id", issueId(args))]
      setIfPresent(argv, "title", title?.trim())
      setIfPresent(argv, "body", body)
      setIfPresent(argv, "task", task)
      return api.verb("issue-update", argv)
    },
  },
  "issue.setStatus": {
    kind: "write",
    destructive: false,
    wraps: "rove api issue-update --status",
    run: (args, { api }) =>
      api.verb("issue-update", [
        flag("repo", absPath(args, "repo")),
        flag("id", issueId(args)),
        flag("status", oneOf(args, "status", ISSUE_STATUSES)),
      ]),
  },
  "issue.delete": {
    kind: "write",
    destructive: true,
    wraps: "rove api issue-delete (the tracker record only; a linked task and worktree stay)",
    run: (args, { api }) => api.verb("issue-delete", [flag("repo", absPath(args, "repo")), flag("id", issueId(args))]),
  },
  "issue.prompt": {
    kind: "read",
    destructive: false,
    wraps: "rove api issue-list + the kanban drawer's issueWorktreePrompt/issueProjectPrompt helpers",
    async run(args, { api }) {
      const where = oneOf(args, "where", ["worktree", "project"] as const)
      const id = issueId(args)
      const listed = await api.verb<{ issues: readonly Issue[] }>("issue-list", [flag("repo", absPath(args, "repo"))])
      const issue = listed.issues.find((i) => i.id === id)
      if (!issue) throw new BridgeError("ISSUE_NOT_FOUND", `no issue #${id}`)
      const cli = roveApiInvocation()
      return {
        title: issueChatTaskTitle(issue),
        prompt: where === "worktree" ? issueWorktreePrompt(issue, cli) : issueProjectPrompt(issue, cli),
      }
    },
  },
  "task.events": {
    kind: "read",
    destructive: false,
    wraps: "daemon RPC task.recentEvents, newest first, as the drawer's EVENTS rows",
    async run(args, { api }) {
      const id = taskId(args)
      const limit = optInt(args, "limit", 1, 100) ?? EVENT_LIMIT
      try {
        const res = await api.rpc<{ events: readonly RecentTaskEvent[] }>("task.recentEvents", { taskId: id })
        const rows = res.events
          .slice(-limit)
          .reverse()
          .map((event) => ({
            kind: event.kind,
            at: event.at,
            // Detail + vendor joined, as the TUI renders the tail of a row.
            tail: [detailFragment(event), event.vendor ?? ""].filter((part) => part.length > 0).join(" · "),
          }))
        return { events: rows }
      } catch (err) {
        // The TUI reads a task the daemon forgot as "no events", not as a failure to act on.
        if (err instanceof Error && /task not found/i.test(err.message)) return { events: [] }
        throw err
      }
    },
  },

  // ── routines ────────────────────────────────────────────────────────────────
  "routine.list": {
    kind: "read",
    destructive: false,
    wraps: "rove api routine-list",
    run: (_args, { api }) => api.verb("routine-list", []),
  },
  "routine.create": {
    kind: "write",
    destructive: false,
    wraps: "rove api routine-create (name, repo, prompt, schedule; never a precheck)",
    run: (args, { api }) =>
      api.verb("routine-create", [
        flag("repo", absPath(args, "repo")),
        flag("name", text(args, "name", NAME_MAX).trim()),
        flag("prompt", text(args, "prompt", PROMPT_MAX)),
        flag("schedule", cron(args, "schedule")),
      ]),
  },
  "routine.update": {
    kind: "write",
    destructive: false,
    wraps: "rove api routine-update (name, prompt, schedule; never a precheck)",
    run: (args, { api }) => {
      const name = optText(args, "name", NAME_MAX)
      const prompt = optText(args, "prompt", PROMPT_MAX)
      const schedule = optStr(args, "schedule") === undefined ? undefined : cron(args, "schedule")
      if (name === undefined && prompt === undefined && schedule === undefined) {
        throw new BridgeError("BAD_ARGS", "routine.update needs name, prompt and/or schedule")
      }
      const argv = [flag("id", taskId(args, "id"))]
      setIfPresent(argv, "name", name?.trim())
      setIfPresent(argv, "prompt", prompt)
      setIfPresent(argv, "schedule", schedule)
      return api.verb("routine-update", argv)
    },
  },
  "routine.setEnabled": {
    kind: "write",
    destructive: false,
    wraps: "rove api routine-update --enabled",
    run: (args, { api }) =>
      api.verb("routine-update", [flag("id", taskId(args, "id")), flag("enabled", String(bool(args, "enabled")))]),
  },
  "routine.runNow": {
    kind: "write",
    destructive: false,
    wraps: "rove api routine-run-now (skips the precheck; the schedule does not shift)",
    run: (args, { api }) => api.verb("routine-run-now", [flag("id", taskId(args, "id"))]),
  },
  "routine.runs": {
    kind: "read",
    destructive: false,
    wraps: "rove api routine-runs",
    run: (args, { api }) => api.verb("routine-runs", [flag("id", taskId(args, "id"))]),
  },
  "routine.delete": {
    kind: "write",
    destructive: true,
    wraps: "rove api routine-delete (the routine and its history; tasks it created stay)",
    run: (args, { api }) => api.verb("routine-delete", [flag("id", taskId(args, "id"))]),
  },

  // ── GitHub issues (read-only through `gh`, plus start a task on one) ────────────
  "workitem.list": {
    kind: "read",
    destructive: false,
    // The RPC, not the verb: only the RPC can bypass the daemon's 60s cache (`refresh`).
    wraps: "daemon RPC workitem.list (same call as rove api workitem-list, plus refresh)",
    run: (args, { api }) => {
      const state = optOneOf(args, "state", ["open", "closed", "all"] as const)
      const assignee = optOneOf(args, "assignee", ["@me"] as const)
      const search = optText(args, "search", 200)
      const limit = optInt(args, "limit", 1, 50)
      return api.rpc("workitem.list", {
        repo: absPath(args, "repo"),
        ...(state ? { state } : {}),
        ...(assignee ? { assignee } : {}),
        ...(search ? { search } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(optBool(args, "refresh") ? { refresh: true } : {}),
      })
    },
  },
  "workitem.links": {
    kind: "read",
    destructive: false,
    wraps: "daemon RPC task.list, folded to the tasks already started from a GitHub issue of this repo",
    async run(args, { api }) {
      const repo = absPath(args, "repo")
      const { tasks } = await api.rpc<TaskListed>("task.list", {})
      const links = tasks.flatMap((task) =>
        task.linkedWorkItem?.number !== undefined && samePath(task.repo, repo)
          ? [{ number: task.linkedWorkItem.number, taskId: task.id }]
          : [],
      )
      return { links }
    },
  },
  "workitem.start": {
    kind: "write",
    destructive: false,
    wraps: "rove api workitem-start",
    run(args, { api }) {
      const number = optInt(args, "number", 1, 1_000_000_000)
      if (number === undefined) throw new BridgeError("BAD_ARGS", "number must be an issue number")
      const argv = [flag("repo", absPath(args, "repo")), flag("number", number)]
      setIfPresent(argv, "vendor", optOneOf(args, "engine", ALL_VENDORS as readonly string[]))
      return api.verb("workitem-start", argv)
    },
  },
}
