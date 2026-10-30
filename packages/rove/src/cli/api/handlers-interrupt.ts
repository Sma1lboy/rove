/**
 * `interrupt` — stop the turn an engine is in the middle of, keeping the
 * conversation and worktree (unlike `tab-close`/`delete`; `send` can't reach
 * a busy composer).
 *
 * A plain `pty.write` of the engine's own declared bytes
 * (`EngineCapabilities.interruptSequence`). Undeclared engines are refused,
 * never guessed at: Esc and ctrl-C mean opposite things across engines and
 * one of them quits.
 *
 * `--group`/`--all` interrupt only the members whose engine is `running`: the
 * same bytes on an idle composer are not a no-op (a second Esc rewinds).
 */

import { errorMessage } from "@/lib/error-message"
import { type AliasRef, hostedKeyFor } from "@sma1lboy/rove-daemon/daemon/pty-alias"
import { openHostedSessionHost } from "../../engine/hosted-session.ts"
import { findHostedEngineKey, listHostedSessions } from "../../engine/hosted-session.ts"
import { getCapabilities } from "../../engine/registry.ts"
import type { VendorId } from "../../types/vendor.ts"
import { readActivityRegistry } from "./activity-view.ts"
import { F } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ptyScopeOf } from "./pty-scope.ts"
import { taskEngineArgv } from "./tab-snapshot.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

interface InterruptTask {
  readonly id: string
  readonly vendor?: string
  readonly command?: string
  readonly ptyAlias?: AliasRef
}

/**
 * The bytes for this task's engine, or a typed refusal — `UNSUPPORTED` for a
 * `generic` protocol engine, whose spelling of "cancel" nothing knows.
 */
function interruptSequenceFor(task: InterruptTask): string {
  const vendor = task.vendor as VendorId | undefined
  const sequence = vendor ? getCapabilities(vendor)?.interruptSequence : undefined
  if (sequence) return sequence
  throw new ApiError(`engine ${vendor ?? "(unknown)"} has not declared how it is interrupted`, "UNSUPPORTED", {
    taskId: task.id,
    ...(vendor ? { vendor } : {}),
    hint: "only engines that declare an interrupt sequence can be interrupted — stop this one by hand in its tab, or close the tab with `tab-close`",
    nextCommandArgs: ["api", "get-task", "--task-id", task.id],
  })
}

async function interruptTask(ctx: VerbContext): Promise<unknown> {
  const taskId = ctx.args.str("task-id")
  const groupId = ctx.args.str("group")
  const all = ctx.args.bool("all") ?? false
  const tabFlag = ctx.args.str("tab")
  const targets = [taskId !== undefined, groupId !== undefined, all].filter(Boolean).length
  if (targets > 1) throw new ApiError("pass one of --task-id, --group or --all", "BAD_FLAG")
  if (targets === 0) throw new ApiError("interrupt needs --task-id ID, --group GROUPID or --all", "MISSING_TARGET")
  if (taskId !== undefined) return interruptOne(ctx, taskId, tabFlag)
  if (tabFlag) throw new ApiError("--tab names one task's tab; it only goes with --task-id", "BAD_FLAG")
  return interruptMany(ctx, groupId)
}

/** Every running member of a round (or of the machine); a member's refusal is recorded, not thrown. */
async function interruptMany(ctx: VerbContext, groupId: string | undefined): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const { tasks } = await daemon.request<{ tasks: { id: string; groupId?: string }[] }>("task.list")
  const members = groupId === undefined ? tasks : tasks.filter((t) => t.groupId === groupId)
  if (groupId !== undefined && members.length === 0) {
    throw new ApiError(`no tasks in group ${groupId}`, "TASK_NOT_FOUND", {
      hint: "the groupId is the one `add --count` returned; any surviving sibling's `.groupId` in `list` recovers it",
      nextCommandArgs: ["api", "list"],
    })
  }
  const activity = await readActivityRegistry(daemon)
  if (!activity) {
    throw new ApiError("could not read engine activity, so which tasks are running is unknown", "BAD_DAEMON", {
      hint: "interrupt the tasks one at a time with --task-id",
      nextCommandArgs: ["api", "inspect"],
    })
  }
  const results: unknown[] = []
  for (const member of members) {
    const state = activity.tasks[member.id]?.state
    if (state !== "running") {
      results.push({ taskId: member.id, status: "skipped" as const, state: state ?? null })
      continue
    }
    try {
      results.push({ ...(await interruptOne(ctx, member.id, undefined)), status: "interrupted" as const })
    } catch (err) {
      results.push({
        taskId: member.id,
        status: "failed" as const,
        error: errorMessage(err),
        ...(err instanceof ApiError ? { code: err.code } : {}),
      })
    }
  }
  const count = (status: string) => results.filter((r) => (r as { status: string }).status === status).length
  return {
    ...(groupId !== undefined ? { groupId } : {}),
    count: members.length,
    interrupted: count("interrupted"),
    failures: count("failed"),
    results,
  }
}

async function interruptOne(ctx: VerbContext, taskId: string, tabFlag: string | undefined) {
  const { task } = await daemonOf(ctx).request<{ task: InterruptTask }>("task.get", { taskId })
  // Before opening the pty host, so UNSUPPORTED doesn't depend on whether a
  // host happens to be up.
  const sequence = interruptSequenceFor({ ...task, id: taskId })

  const host = await openHostedSessionHost()
  if (!host) {
    throw new ApiError(`no pty host to reach task ${taskId}`, "NO_ENGINE_TAB", {
      taskId,
      hint: "nothing is hosting this task's engine — `pty-list` says whether a host is up at all",
      nextCommandArgs: ["api", "pty-list"],
    })
  }
  try {
    const sessions = await listHostedSessions(host.rpc)
    // A migrated child's tab is the parent-keyed PTY; a PTY another task's alias claims is not this task's to stop.
    const scope = await ptyScopeOf(daemonOf(ctx), task)
    const key = tabFlag
      ? hostedKeyFor(taskId, tabFlag, scope)
      : findHostedEngineKey(sessions, taskId, taskEngineArgv(task)[0], scope)
    if (!key || !sessions.some((session) => session.key === key && session.alive)) {
      throw new ApiError(
        tabFlag ? `task ${taskId} has no live tab ${tabFlag}` : `task ${taskId} has no live engine tab to interrupt`,
        tabFlag ? "TAB_NOT_FOUND" : "NO_ENGINE_TAB",
        {
          taskId,
          ...(tabFlag ? { tabId: tabFlag } : {}),
          hint: "`get-task` lists the live tabs in .tabs[]",
          nextCommandArgs: ["api", "get-task", "--task-id", taskId],
        },
      )
    }
    await host.rpc.request("pty.write", { key, data: sequence })
    // `interrupted` is the WRITE, not the effect; the effect shows in
    // `collect`'s `.activity.state`.
    return {
      ok: true,
      taskId,
      tabId: key.split("::")[1] ?? "tab-1",
      vendor: task.vendor,
      interrupted: true,
      bytes: Buffer.byteLength(sequence, "utf8"),
    }
  } finally {
    host.close()
  }
}

export const INTERRUPT_VERB: VerbSpec = {
  name: "interrupt",
  group: "drive",
  summary:
    "Stop the turn a task's engine is currently running — the headless twin of pressing the engine's own interrupt key. Writes the ENGINE-declared interrupt bytes to its pty; the session, its conversation and its worktree all survive, which is what separates this from `tab-close` and `delete`. Use it when a worker runs away: `send` cannot reach it (a busy engine's composer is not quiet), and until now the only levers left destroyed something. Engines that have not declared an interrupt sequence (every `generic` protocol engine) are refused with UNSUPPORTED rather than guessed at — Esc and ctrl-C mean opposite things across engines. Returns { taskId, tabId, vendor, interrupted, bytes }; `interrupted` reports the WRITE, so read `collect`'s .activity.state for the effect. Pass --group (one fan-out round) or --all (every task on this machine) instead of --task-id to stop many at once: only members whose engine is `running` are written to, and the reply is { groupId?, count, interrupted, failures, results } with one entry per member — status interrupted, skipped (with its .state) or failed (with .error/.code).",
  flags: [
    F.taskId(false),
    {
      name: "group",
      type: "string",
      placeholder: "GROUPID",
      description:
        "Interrupt every running task of one fan-out round (the `groupId` that `add --count` returns). Mutually exclusive with --task-id and --all.",
    },
    {
      name: "all",
      type: "bool",
      description: "Interrupt every running task on this machine. Mutually exclusive with --task-id and --group.",
    },
    {
      name: "tab",
      type: "string",
      placeholder: "TAB",
      description:
        "Interrupt this exact tab (id from `get-task` .tabs[].id). Omitted = the task's canonical engine tab, the same one a bare `send` targets. Only with --task-id.",
    },
  ],
  handler: interruptTask,
}
