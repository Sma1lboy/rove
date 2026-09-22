/**
 * Fan a quick-fork prompt out to N siblings of ONE round (the keyboard path to
 * `rove api add --count N --prompt …`). Unlike a single fork:
 * - it stamps one `groupId` on every sibling, so `rove api collect --group`
 *   finds them;
 * - it enters no sibling (focus-preserving, like `rove api add`);
 * - so it can't use the one-prompt pending slot: delivery goes through the
 *   headless session starter in `core/`, prompt in argv, mounted or not.
 *
 * Creation SERIAL (keeps requested order), delivery CONCURRENT, matching
 * `cli/api/handlers-add.ts`.
 */

import { errorMessage } from "@/lib/error-message"
import type { DaemonRpcClient } from "@sma1lboy/kobe-daemon/client/rpc"
import { startTaskSessionWithPromptAdapter } from "../../core/daemon-session-adapter"
import { planRound } from "../../core/round"
import { addSavedRepo } from "../../state/repos"
import { setRepoLastActiveVendor } from "../../state/vendor-prefs"
import type { Task, VendorId } from "../../types/task"

export interface RoundOrchestrator {
  createTask(input: {
    repo: string
    baseRef: string
    vendor: VendorId
    groupId?: string
    title?: string
  }): Promise<Task>
  setPrompt(id: string, prompt: string): Promise<void>
  /** Request/response seam onto the owning daemon — what delivery needs. */
  readonly rpc: DaemonRpcClient
}

export interface RoundOutcome {
  /** Siblings whose engine session started with the prompt. */
  readonly started: readonly string[]
  /** Human lines: undelivered siblings plus the attempt that failed to create. */
  readonly failures: readonly string[]
  /** Siblings that were created, started or not — the round's real size. */
  readonly created: readonly string[]
}

/** Injectable delivery, so the round's own logic is testable without a PTY host. */
export type RoundDeliver = (rpc: DaemonRpcClient, taskId: string, prompt: string) => Promise<boolean>

const realDeliver: RoundDeliver = async (rpc, taskId, prompt) =>
  (await startTaskSessionWithPromptAdapter(rpc, taskId, prompt)).started

/** Create `attempts` siblings sharing one `groupId`, then prompt each. Never
 *  throws and never unwinds: created siblings are work in progress. */
export async function runQuickForkRound(
  orch: RoundOrchestrator,
  repo: string,
  input: { readonly baseRef: string; readonly vendor: VendorId; readonly prompt: string; readonly attempts: number },
  deliver: RoundDeliver = realDeliver,
): Promise<RoundOutcome> {
  setRepoLastActiveVendor(repo, input.vendor)
  addSavedRepo(repo)

  const plan = planRound(input.attempts)
  const created: string[] = []
  const failures: string[] = []
  for (const sibling of plan) {
    try {
      const task = await orch.createTask({ repo, baseRef: input.baseRef, vendor: input.vendor, ...sibling })
      created.push(task.id)
    } catch (err) {
      // Stop at the first create failure (it will recur); keep those created.
      failures.push(`create: ${errorMessage(err)}`)
      break
    }
  }

  const settled = await Promise.allSettled(created.map((id) => deliver(orch.rpc, id, input.prompt)))
  const started: string[] = []
  settled.forEach((result, i) => {
    const id = created[i] ?? ""
    if (result.status === "fulfilled" && result.value) {
      started.push(id)
      return
    }
    failures.push(
      result.status === "rejected" ? `${id}: ${errorMessage(result.reason)}` : `${id}: prompt not delivered`,
    )
  })

  // Brief on every CREATED sibling, delivered or not ("Run again" reads it).
  // Best-effort: a failed persist must not fail a started attempt.
  await Promise.all(created.map((id) => orch.setPrompt(id, input.prompt).catch(() => undefined)))

  return { started, failures, created }
}
