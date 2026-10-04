/**
 * `interrupt` — stop the turn an engine is in the middle of, keeping the
 * conversation and worktree (unlike `tab-close`/`delete`; `send` can't reach
 * a busy composer).
 *
 * A plain `pty.write` of the engine's own declared bytes
 * (`EngineCapabilities.interruptSequence`). Undeclared engines are refused,
 * never guessed at: Esc and ctrl-C mean opposite things across engines and
 * one of them quits.
 */

import { openHostedSessionHost } from "../../engine/hosted-session.ts"
import { findHostedEngineKey, listHostedSessions } from "../../engine/hosted-session.ts"
import { getCapabilities } from "../../engine/registry.ts"
import type { VendorId } from "../../types/vendor.ts"
import { F } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import { taskEngineArgv } from "./tab-snapshot.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

interface InterruptTask {
  readonly id: string
  readonly vendor?: string
  readonly command?: string
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
  const taskId = ctx.args.require("task-id")
  const tabFlag = ctx.args.str("tab")
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
    const key = tabFlag ? `${taskId}::${tabFlag}` : findHostedEngineKey(sessions, taskId, taskEngineArgv(task)[0])
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
    "Stop the turn a task's engine is currently running — the headless twin of pressing the engine's own interrupt key. Writes the ENGINE-declared interrupt bytes to its pty; the session, its conversation and its worktree all survive, which is what separates this from `tab-close` and `delete`. Use it when a worker runs away: `send` cannot reach it (a busy engine's composer is not quiet), and until now the only levers left destroyed something. Engines that have not declared an interrupt sequence (every `generic` protocol engine) are refused with UNSUPPORTED rather than guessed at — Esc and ctrl-C mean opposite things across engines. Returns { taskId, tabId, vendor, interrupted, bytes }; `interrupted` reports the WRITE, so read `collect`'s .activity.state for the effect.",
  flags: [
    F.taskId(),
    {
      name: "tab",
      type: "string",
      placeholder: "TAB",
      description:
        "Interrupt this exact tab (id from `get-task` .tabs[].id). Omitted = the task's canonical engine tab, the same one a bare `send` targets.",
    },
  ],
  handler: interruptTask,
}
