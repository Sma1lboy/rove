/**
 * The `edit` verb group: `update`, the one verb that changes a task's
 * METADATA — title, branch, engine command/model/effort, pin, status + worker
 * report — or with `--tab` one Terminal Tab's name. Each spec's own `group`
 * field, not this file, decides where it lists; specs spread into {@link VERBS}.
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { GENERIC_PROTOCOL, resolveCommandProtocol } from "../../engine/engine-presets.ts"
import type { TaskStatus } from "../../types/task.ts"
import type { VendorId } from "../../types/vendor.ts"
import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { assertEngineAcceptsEffort, assertEngineAcceptsModel, taskEngine, vendorToRecord } from "./handlers-engines.ts"
import { renameTabsSnapshot } from "./tab-snapshot.ts"
import { TASK_STATUSES } from "./task-statuses.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

const TASK_FIELDS = ["title", "branch", "command", "model", "effort", "pinned", "status"] as const
const REPORT_FLAGS = ["report-branch", "report-pr", "report-summary"] as const

/**
 * `--tab` writes the snapshot, THEN broadcasts: the write is the whole rename
 * with no TUI attached; the broadcast stops an attached one overwriting the
 * file with the old name. `setTabTitle` is idempotent, so no request/reply
 * broker is needed (unlike `tab-close`).
 */
async function renameTab(ctx: VerbContext, taskId: string, tabId: string): Promise<unknown> {
  const title = ctx.args.str("title")
  const others = [...TASK_FIELDS, ...REPORT_FLAGS].filter((f) => f !== "title" && ctx.args.str(f) !== undefined)
  if (title === undefined || others.length > 0) {
    throw new ApiError("--tab only renames a tab: pass --title and no other field", "BAD_FLAG", {
      hint: "Update the task's own fields in a separate call without --tab.",
    })
  }
  if (!renameTabsSnapshot(taskId, tabId, title)) {
    throw new ApiError(`task ${taskId} has no tab ${tabId}`, "TAB_NOT_FOUND", {
      hint: "`get-task` lists the addressable tab ids in .tabs[].id",
      nextCommandArgs: ["api", "get-task", "--task-id", taskId],
    })
  }
  const reply = await daemonOf(ctx).request<{ clients?: number }>("terminalTab.rename", { taskId, tabId, title })
  return { ok: true, taskId, tabId, title, renamed: true, clients: reply.clients ?? 0 }
}

/**
 * Validate every field, then apply them one RPC at a time: the git-side
 * branch rename (the step most likely to refuse) first, then the engine, then
 * plain metadata. Not atomic — a refusal mid-way names what already applied.
 */
async function updateTask(ctx: VerbContext): Promise<unknown> {
  const taskId = ctx.args.require("task-id")
  const tabId = ctx.args.str("tab")
  if (tabId !== undefined) return renameTab(ctx, taskId, tabId)

  const title = ctx.args.str("title")
  const branch = ctx.args.str("branch")
  const command = ctx.args.str("command")?.trim()
  const model = ctx.args.str("model")?.trim()
  const effort = ctx.args.str("effort")?.trim()
  const pinned = ctx.args.bool("pinned")
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
  const step = async (fields: readonly string[], method: string, payload: Record<string, unknown>) => {
    try {
      await simpleRpc(ctx, method, { taskId, ...payload })
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
  if (status !== undefined) await step(["status"], "task.status", { status, ...report })

  return {
    ok: true,
    taskId,
    updated: applied,
    ...(command ? { command, protocol, ...(protocol === GENERIC_PROTOCOL ? { generic: true } : {}) } : {}),
    ...(engine ? { engine } : {}),
  }
}

export const EDIT_VERBS: readonly VerbSpec[] = [
  {
    name: "update",
    group: "edit",
    summary:
      "Change a task's metadata — any combination of title, branch (git branch -m if materialized, else recorded), engine --command / --model / --effort (take effect on the next session rebuild), pin, and status + worker report — in one call. Every field is validated before anything is written; then they apply in order branch → engine → title/pin/status, and a refusal mid-way names what already applied (`applied`). With --tab, renames that Terminal Tab instead (the API twin of the TUI's f2) and takes only --title. The status is a cosmetic LABEL: `--status canceled` closes, stops and cleans up nothing — `delete` ends a task. The --report-* fields record what the WORKER CLAIMS it delivered (`.report` on `get-task` / `collect`), deliberately apart from `.prStatus`, which the daemon polled from the forge; they merge onto any previous report and need --status. Returns { updated } — the fields written, in order.",
    flags: [
      F.taskId(),
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
          "Rename this Terminal Tab (id from `get-task` .tabs[].id, e.g. tab-2) instead of the task; only --title may accompany it. TAB_NOT_FOUND when the task's snapshot names no such tab.",
      },
      { name: "branch", type: "string", placeholder: "B", description: "New branch name." },
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
          "Reasoning effort level the task's engine declares (codex: none/low/medium/high/xhigh/max; pi, omp: off/minimal/low/medium/high/xhigh/max; claude: none). BAD_EFFORT names the accepted levels.",
      },
      {
        name: "pinned",
        type: "bool",
        placeholder: "BOOL",
        description: "true pins the task to the top of the sidebar, false unpins.",
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
