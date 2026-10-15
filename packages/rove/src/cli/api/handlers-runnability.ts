/**
 * `should-run`: ask the daemon whether a tick sent to a task would be used
 * (docs/design/long-run-controls.md § 2). The verdict is the daemon's one
 * answer; `send --if-runnable`, the routine runner and `get-task` read the same.
 */

import {
  type RunnabilityVerdict,
  SHOULD_RUN_SKIP_EXIT_CODE,
  SKIP_REASONS,
} from "@sma1lboy/rove-daemon/daemon/contracts"
import type { DaemonRpc } from "../daemon-session.ts"
import { F } from "./flags.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

/** A task's verdict for `get-task` / `collect`; undefined when the daemon is too old to answer. */
export async function readRunnability(daemon: DaemonRpc, taskId: string): Promise<RunnabilityVerdict | undefined> {
  try {
    return await daemon.request<RunnabilityVerdict>("task.runnability", { taskId })
  } catch {
    return undefined
  }
}

async function shouldRun(ctx: VerbContext): Promise<unknown> {
  const tab = ctx.args.str("tab")
  if (tab && tab !== "new" && !/^tab-[A-Za-z0-9-]+$/.test(tab)) {
    throw new ApiError(`--tab must be "new" or a tab id like tab-2 (got ${JSON.stringify(tab)})`, "BAD_TAB")
  }
  const verdict = await daemonOf(ctx).request<RunnabilityVerdict>("task.runnability", {
    taskId: ctx.args.require("task-id"),
    ...(tab ? { tabId: tab } : {}),
  })
  // Exit 3 with the verdict on stdout, like a partial fan-out: "non-zero" means skip, and the reason is not lost.
  if (!verdict.run) throw new ApiError(`skip: ${verdict.reason}`, "SKIPPED", { ...verdict })
  return verdict
}

export const SHOULD_RUN_VERB: VerbSpec = {
  name: "should-run",
  group: "read",
  summary: `Would a tick sent to this task be used? Prints the verdict {run:true} or {run:false, reason, detail?, until?, gateIds?} and exits 0 on run, ${SHOULD_RUN_SKIP_EXIT_CODE} on skip (the verdict is still on stdout). reason, first match wins: ${SKIP_REASONS.join(" | ")}. \`awaiting-owner\` = an open gate (answer or withdraw it), \`report-missing\` = the last delivery ended unreported (late \`report\`, or dismiss its Inbox row), \`quota\` clears itself at \`until\`, \`engine-error\` / \`engine-dead\` clear on the engine's next turn or a restart, \`awaiting-permission\` = the engine waits on an approval, \`busy\` = a turn is running or the last delivery still awaits its report. A task whose only gate is answered-but-undelivered is runnable: the next tick carries the answer. Without --tab the whole task is judged and a dead engine is not a skip (\`send\` revives it); --tab tab-N judges that tab and a dead engine is \`engine-dead\`; --tab new judges only task-level state. To check and send in one step use \`send --if-runnable\`.`,
  flags: [
    F.taskId(true),
    {
      name: "tab",
      type: "string",
      required: false,
      placeholder: "TAB",
      description:
        'Judge exactly this tab (e.g. tab-2), or "new" for a tab about to be created. Omitted = the whole task.',
    },
  ],
  handler: shouldRun,
}

async function attentionDismiss(ctx: VerbContext): Promise<unknown> {
  const delivery = ctx.args.require("delivery")
  const res = await daemonOf(ctx).request<{ deleted: boolean; found?: boolean }>("attention.dismiss", {
    deliveryId: delivery,
  })
  if (res.found === false) {
    throw new ApiError(`no delivery ${delivery}`, "DELIVERY_NOT_FOUND", {
      hint: "`deliveries --task-id <id>` lists a task's delivery ids; the Inbox row names it as d-N.",
    })
  }
  return { ok: true, delivery, cleared: true }
}

export const ATTENTION_DISMISS_VERB: VerbSpec = {
  name: "attention-dismiss",
  group: "drive",
  summary:
    'Dismiss a `report_missing` Inbox row by its delivery id (d-N): the owner\'s deliberate "seen, carry on" for a tick that ended without a report. It unblocks `should-run` for the task. Opening or visiting the row never does this, and a late `report` clears it on its own. Idempotent; an unknown id is DELIVERY_NOT_FOUND.',
  flags: [
    { name: "delivery", type: "string", required: true, placeholder: "ID", description: "Delivery id, e.g. d-41." },
  ],
  handler: attentionDismiss,
}
