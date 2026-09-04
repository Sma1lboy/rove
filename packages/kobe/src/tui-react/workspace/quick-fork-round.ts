/**
 * Fan a quick-fork prompt out to N siblings of ONE round — the keyboard path
 * to what `rove api add --count N --prompt …` does from a shell.
 *
 * Its own module because the round differs from the single fork in every
 * respect that matters, and folding it into `quick-fork.ts` would hide that:
 *
 * - it mints a `groupId` and stamps it on every sibling, which is the only
 *   thing that makes `rove api collect --group <id>` able to find them. Three
 *   forks fired by hand are three loose tasks, not a round;
 * - it does NOT select or enter any sibling. `rove api add` is focus-preserving
 *   unless you pass `--activate`, and a round that yanks you into attempt #3 is
 *   worse than one that leaves you where you were. A single fork keeps its
 *   focus-stealing "carry on from here" behaviour, which is why that path stays
 *   in `quick-fork.ts` untouched;
 * - it therefore cannot use the pending-prompt slot, which pastes on the NEW
 *   task's `TerminalTabs` mount and structurally holds at most one prompt.
 *   Delivery goes through the headless session starter in `core/` — the same
 *   one the daemon's automation runner and work-item start use — so a sibling
 *   boots its engine with the prompt in its argv whether or not anything is
 *   mounted on it.
 *
 * Creation is SERIAL and delivery CONCURRENT, matching
 * `cli/api/handlers-add.ts`: `task.create` is a store write, and ordered
 * creation keeps the siblings in the order you asked for them, while N engine
 * cold-boots have no reason to queue behind each other.
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
  /** Siblings that exist but whose engine never took the prompt, plus the
   *  attempt that could not be created at all. Each entry is a human line. */
  readonly failures: readonly string[]
  /** Siblings that were created, started or not — the round's real size. */
  readonly created: readonly string[]
}

/** Injectable delivery, so the round's own logic is testable without a PTY host. */
export type RoundDeliver = (rpc: DaemonRpcClient, taskId: string, prompt: string) => Promise<boolean>

const realDeliver: RoundDeliver = (rpc, taskId, prompt) => startTaskSessionWithPromptAdapter(rpc, taskId, prompt)

/**
 * Create `attempts` siblings sharing one `groupId`, then hand each the same
 * prompt. Never throws: a round that half-succeeded still leaves real tasks
 * with engines burning tokens, so every created id comes back and the caller
 * reports rather than unwinds. Deleting a sibling because its neighbour failed
 * would destroy work in progress.
 */
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
      // Stop at the first create failure — a store write that fails once will
      // fail again — but keep the siblings already created.
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

  // Record the brief on every CREATED sibling, delivered or not: "Run again"
  // and `rove api get-task` both read it, and a sibling whose paste failed is
  // exactly the one you want to re-run. Best-effort — a failed persist must
  // not turn a started attempt into a failure.
  await Promise.all(created.map((id) => orch.setPrompt(id, input.prompt).catch(() => undefined)))

  return { started, failures, created }
}
