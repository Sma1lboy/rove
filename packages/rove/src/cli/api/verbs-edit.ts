/**
 * The `edit` verb group: `update`, the one verb that changes a task's
 * METADATA — title, branch, engine command/model/effort, pin, status + worker
 * report — or with `--tab` one Terminal Tab's name. Each spec's own `group`
 * field, not this file, decides where it lists; specs spread into {@link VERBS}.
 */

import { errorMessage } from "@/lib/error-message"
import type { ReparentResult } from "@sma1lboy/rove-daemon/daemon/contracts"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { GENERIC_PROTOCOL, resolveCommandProtocol } from "../../engine/engine-presets.ts"
import type { TaskStatus } from "../../types/task.ts"
import type { VendorId } from "../../types/vendor.ts"
import { ownSession, replyTabOf } from "./dispatcher.ts"
import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { assertEngineAcceptsEffort, assertEngineAcceptsModel, taskEngine, vendorToRecord } from "./handlers-engines.ts"
import { renameTabsSnapshot } from "./tab-snapshot.ts"
import { TASK_STATUSES } from "./task-statuses.ts"
import { ApiError, type VerbContext, type VerbSpec, helpStep, splitDaemonCode } from "./types.ts"

const TASK_FIELDS = [
  "title",
  "branch",
  "parent",
  "command",
  "model",
  "effort",
  "pinned",
  "require-report",
  "status",
] as const
const REPORT_FLAGS = ["report-branch", "report-pr", "report-summary"] as const

/**
 * `--tab` renames through the daemon's tab store (`tabs.apply`), which every
 * attached TUI follows on `tabs.changed`; the `terminalTab.rename` broadcast
 * after it is kept for older listeners. `setTabTitle` is idempotent, so no
 * request/reply broker is needed (unlike `tab-close`).
 */
async function renameTab(ctx: VerbContext, taskId: string, tabId: string): Promise<unknown> {
  const title = ctx.args.str("title")
  const others = [...TASK_FIELDS, ...REPORT_FLAGS].filter((f) => f !== "title" && ctx.args.str(f) !== undefined)
  if (title === undefined || others.length > 0) {
    throw new ApiError("--tab only renames a tab: pass --title and no other field", "BAD_FLAG", {
      hint: "Update the task's own fields in a separate call without --tab.",
    })
  }
  const daemon = daemonOf(ctx)
  if (!(await renameTabsSnapshot(daemon, taskId, tabId, title))) {
    throw new ApiError(`task ${taskId} has no tab ${tabId}`, "TAB_NOT_FOUND", {
      hint: "`get-task` lists the addressable tab ids in .tabs[].id",
      nextCommandArgs: ["api", "get-task", "--task-id", taskId],
    })
  }
  const reply = await daemon.request<{ clients?: number }>("terminalTab.rename", { taskId, tabId, title })
  return { ok: true, taskId, tabId, title, renamed: true, clients: reply.clients ?? 0 }
}

/** `--task-id`, else the caller's own verified session (so an agent can retitle the task it runs in). */
async function resolveTarget(ctx: VerbContext): Promise<string> {
  const explicit = ctx.args.str("task-id")
  if (explicit) return explicit
  const self = await ownSession(daemonOf(ctx))
  if (!self) {
    throw new ApiError(
      "no --task-id given and the caller is not a verified rove session — pass --task-id ID",
      "MISSING_TARGET",
      helpStep("update"),
    )
  }
  return self.taskId
}

/** `--parent none`: promote to top level. */
const NO_PARENT = "none"

/**
 * `--group G --parent Y`: every task of one fan-out round moves under Y. A member's refusal is RECORDED, not
 * thrown (as `delete --group`): aborting would hide which of N already moved.
 */
async function reparentGroup(ctx: VerbContext, groupId: string): Promise<unknown> {
  const parent = ctx.args.str("parent")
  const stray = ["task-id", "tab", ...TASK_FIELDS.filter((f) => f !== "parent"), ...REPORT_FLAGS].filter(
    (f) => ctx.args.str(f) !== undefined,
  )
  if (parent === undefined || parent === "" || stray.length > 0) {
    throw new ApiError(
      `--group moves a whole fan-out round and takes only --parent ID (or \`none\`)${stray.length > 0 ? ` — drop ${stray.map((f) => `--${f}`).join(", ")}` : ""}`,
      "BAD_FLAG",
      helpStep("update"),
    )
  }
  const daemon = daemonOf(ctx)
  const { tasks } = await daemon.request<{ tasks: SerializedTask[] }>("task.list")
  const members = tasks.filter((t) => t.groupId === groupId)
  if (members.length === 0) {
    throw new ApiError(`no tasks in group ${groupId}`, "TASK_NOT_FOUND", {
      hint: "the groupId is the one `add --count` returned; any surviving sibling's `.groupId` in `list` recovers it",
      nextCommandArgs: ["api", "list"],
    })
  }
  if (members.some((t) => t.id === parent)) {
    throw new ApiError(
      `${parent} is itself a member of group ${groupId} — a round cannot move under one of its own`,
      "PARENT_IN_GROUP",
      {
        hint: "pick a parent outside the round, or move the members one by one with --task-id",
      },
    )
  }
  const parentTaskId = parent === NO_PARENT ? null : parent
  const replyTab = parentTaskId === null ? undefined : await replyTabOf(ctx.runtime, daemon, parentTaskId)
  const results: unknown[] = []
  let failures = 0
  for (const task of members) {
    try {
      const moved = await simpleRpc<ReparentResult>(ctx, "task.setParent", {
        taskId: task.id,
        parentTaskId,
        ...(replyTab ? { replyTab } : {}),
      })
      results.push({ taskId: task.id, status: "moved", ...moved })
    } catch (err) {
      failures++
      const message = errorMessage(err)
      const coded = err instanceof ApiError ? { code: err.code, rest: message } : splitDaemonCode(message)
      results.push({
        taskId: task.id,
        status: "failed",
        error: coded?.rest ?? message,
        ...(coded ? { code: coded.code } : {}),
      })
    }
  }
  return { ok: failures === 0, groupId, count: members.length, failures, results }
}

/**
 * Validate every field, then apply them one RPC at a time: the parent move first (the daemon's tree rules
 * refuse before anything is written), then the git-side branch rename, the engine, and plain metadata.
 * Not atomic — a refusal mid-way names what already applied.
 */
async function updateTask(ctx: VerbContext): Promise<unknown> {
  const group = ctx.args.str("group")
  if (group !== undefined) return reparentGroup(ctx, group)
  const tabId = ctx.args.str("tab")
  // A tab lives in the snapshot of the task that owns its PTY, which a migrated child's own id does not name.
  const taskId = tabId !== undefined ? ctx.args.require("task-id") : await resolveTarget(ctx)
  if (tabId !== undefined) return renameTab(ctx, taskId, tabId)

  const title = ctx.args.str("title")
  const branch = ctx.args.str("branch")
  const parent = ctx.args.str("parent")
  const command = ctx.args.str("command")?.trim()
  const model = ctx.args.str("model")?.trim()
  const effort = ctx.args.str("effort")?.trim()
  const pinned = ctx.args.bool("pinned")
  const requireReport = ctx.args.enumOf<"on" | "off">("require-report")
  const status = ctx.args.enumOf<TaskStatus>("status")
  const report = {
    reportBranch: ctx.args.str("report-branch"),
    reportPr: ctx.args.int("report-pr"),
    reportSummary: ctx.args.str("report-summary"),
  }
  const reporting = Object.values(report).some((v) => v !== undefined)
  if (TASK_FIELDS.every((f) => ctx.args.str(f) === undefined) && !reporting) {
    throw new ApiError(
      `nothing to update — pass at least one of ${TASK_FIELDS.map((f) => `--${f}`).join(", ")}`,
      "BAD_FLAG",
      {
        nextCommandArgs: ["api", "update", "--help"],
      },
    )
  }
  if (reporting && status === undefined) {
    throw new ApiError("--report-* is recorded with a status: pass --status too", "BAD_FLAG", {
      hint: "A worker reporting delivery usually passes --status in_review (or done).",
    })
  }
  if (command === "") throw new ApiError("--command cannot be empty", "BAD_FLAG")
  if (parent === "")
    throw new ApiError("--parent cannot be empty — pass a task id, or `none` for top level", "BAD_FLAG")

  const daemon = daemonOf(ctx)
  const protocol = command ? resolveCommandProtocol(command) : undefined
  let task: SerializedTask | undefined
  let engine: VendorId | undefined
  if (model !== undefined || effort !== undefined) {
    task = (await daemon.request<{ task: SerializedTask }>("task.get", { taskId })).task
    // Judged against the engine the task WILL run, so `--command codex --effort high` works in one call.
    engine = taskEngine(command ? { ...task, command } : task)
    const recover = ["api", "get-task", "--task-id", taskId]
    if (model !== undefined) assertEngineAcceptsModel(engine, model, recover)
    if (effort !== undefined) assertEngineAcceptsEffort(engine, effort, recover)
  }

  const applied: string[] = []
  const step = async <T>(fields: readonly string[], method: string, payload: Record<string, unknown>): Promise<T> => {
    let reply: T
    try {
      reply = await simpleRpc<T>(ctx, method, { taskId, ...payload })
    } catch (err) {
      if (applied.length === 0) throw err
      const message = err instanceof Error ? err.message : String(err)
      const code = err instanceof ApiError ? err.code : "PARTIAL_UPDATE"
      throw new ApiError(`--${fields.join("/--")} failed after ${applied.join(", ")} applied: ${message}`, code, {
        applied: [...applied],
        failed: fields,
      })
    }
    applied.push(...fields)
    return reply
  }

  let reparented: ReparentResult | undefined
  // The git rename can't be undone, so a tree refusal (cycle, missing parent) must come before it.
  if (parent !== undefined) {
    const parentTaskId = parent === NO_PARENT ? null : parent
    const replyTab = parentTaskId === null ? undefined : await replyTabOf(ctx.runtime, daemon, parentTaskId)
    reparented = await step<ReparentResult>(["parent"], "task.setParent", {
      parentTaskId,
      ...(replyTab ? { replyTab } : {}),
    })
  }
  if (branch !== undefined) await step(["branch"], "task.setBranch", { branch })

  if (command) await step(["command"], "task.setCommand", { command, vendor: protocol })
  if (task && engine) {
    // A command change just recorded `protocol` as the vendor; build on that.
    const recorded = vendorToRecord(protocol ? { ...task, vendor: protocol } : task, engine)
    const fields = [...(model !== undefined ? ["model"] : []), ...(effort !== undefined ? ["effort"] : [])]
    await step(fields, "task.setVendor", { vendor: recorded, model, effort })
  }
  if (title !== undefined) await step(["title"], "task.rename", { title })
  if (pinned !== undefined) await step(["pinned"], "task.pin", { pinned })
  if (requireReport !== undefined) {
    await step(["require-report"], "task.requireReport", { required: requireReport === "on" })
  }
  if (status !== undefined) await step(["status"], "task.status", { status, ...report })

  return {
    ok: true,
    taskId,
    updated: applied,
    ...(reparented ? { parent: reparented } : {}),
    ...(command ? { command, protocol, ...(protocol === GENERIC_PROTOCOL ? { generic: true } : {}) } : {}),
    ...(engine ? { engine } : {}),
  }
}

export const EDIT_VERBS: readonly VerbSpec[] = [
  {
    name: "update",
    group: "edit",
    summary:
      "Change a task's metadata — any combination of title, branch (git branch -m if materialized, else recorded), parent, engine --command / --model / --effort (take effect on the next session rebuild), pin, and status + worker report — in one call. The flags are checked before anything is written; then they apply in order parent → branch → engine → title/pin/status, and a refusal mid-way names what already applied (`applied`). --parent ID re-parents the task without touching its engine, tabs, worktree or branch: the stored parent is ID's top-level ancestor (children never nest, as with `spawn` from a child; the task's own children come along, listed in `.parent.moved`) and the task's reply address becomes ID itself, so its bare `send` reaches ID (the caller's own tab when run from inside ID, else ID's live engine tab, else tab-1). `--parent none` makes the task top level and drops a reply address that pointed into its old tree. A parent must live on the same machine as the task. Archiving the stored parent, or `delete --cascade` on it, takes the task along. --group G --parent ID moves a whole fan-out round instead and takes nothing else. With --tab, renames that Terminal Tab instead (the API twin of the TUI's f2) and takes only --title. The status is a cosmetic LABEL: `--status canceled` closes, stops and cleans up nothing — `delete` ends a task. The --report-* fields record what the WORKER CLAIMS it delivered (`.report` on `get-task` / `collect`), deliberately apart from `.prStatus`, which the daemon polled from the forge; they merge onto any previous report and need --status. Returns { updated } — the fields written, in order.",
    flags: [
      {
        ...F.taskId(false),
        description:
          "Target task id (from `list` / `add`). Default: the calling session's own task, from the verified $ROVE_TASK_ID (an unverifiable env is MISSING_TARGET, never a guess).",
      },
      {
        name: "title",
        type: "string",
        placeholder: "T",
        description: "New task title (or, with --tab, the tab's name).",
      },
      {
        name: "tab",
        type: "string",
        placeholder: "TAB",
        description:
          "Rename this Terminal Tab (id from `get-task` .tabs[].id, e.g. tab-2) instead of the task; needs --task-id, and only --title may accompany it. TAB_NOT_FOUND when the task's snapshot names no such tab.",
      },
      { name: "branch", type: "string", placeholder: "B", description: "New branch name." },
      {
        name: "parent",
        type: "string",
        placeholder: "ID|none",
        description:
          "Move the task under this task (its engine, tabs, worktree and branch stay as they are), or `none` to make it top level. Refusals: PARENT_NOT_FOUND, PARENT_IS_SELF, PARENT_CYCLE, TASK_NOT_MOVABLE, REMOTE_PARENT_UNSUPPORTED.",
      },
      {
        name: "group",
        type: "string",
        placeholder: "GROUPID",
        description:
          "With --parent: move every task of one fan-out round (the `groupId` that `add --count` returns). Takes nothing but --parent; a member's refusal is recorded in `results`, and a parent inside the round is PARENT_IN_GROUP.",
      },
      {
        ...F.command(),
        description:
          "New engine launch command — an engine id from `engine-list` or a full command line. The protocol Rove speaks to it is derived from it; the result reports which (`generic: true` when the command names no engine Rove knows).",
      },
      {
        name: "model",
        type: "string",
        placeholder: "MODEL",
        description:
          "Pin a model, passed to the engine VERBATIM in its own spelling (claude alias or id, codex slug, pi/omp pattern); `engine-list` .models are suggestions, not a closed list. BAD_MODEL when the engine declares no model flag.",
      },
      // Not an enum: levels are declared PER ENGINE (incl. plugin engines).
      {
        name: "effort",
        type: "string",
        placeholder: "LEVEL",
        description:
          "Reasoning effort level the task's engine declares (codex: none/low/medium/high/xhigh/max; pi, omp: off/minimal/low/medium/high/xhigh/max; claude: low/medium/high/xhigh/max). BAD_EFFORT names the accepted levels.",
      },
      {
        name: "pinned",
        type: "bool",
        placeholder: "BOOL",
        description: "true pins the task to the top of the sidebar, false unpins.",
      },
      {
        name: "require-report",
        type: "enum",
        values: ["on", "off"],
        description:
          "on: every later `send` to this task arms a delivery the agent must close with `report --delivery <id>` (a turn that ends without one raises a `report_missing` Inbox row); off: back to plain sends.",
      },
      {
        name: "status",
        type: "enum",
        values: TASK_STATUSES,
        description: "New lifecycle label (cosmetic — see summary).",
      },
      {
        name: "report-branch",
        type: "string",
        placeholder: "B",
        description: "The branch the worker says holds the work (a CLAIM — `.branch` is the task's actual branch).",
      },
      {
        name: "report-pr",
        type: "int",
        placeholder: "N",
        description:
          "The PR number the worker says it opened (a CLAIM — `.prStatus.number` is what the daemon read from the forge).",
      },
      { name: "report-summary", type: "string", placeholder: "TEXT", description: "One line of what was delivered." },
    ],
    handler: updateTask,
  },
]
