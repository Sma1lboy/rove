/** The text a routine firing delivers: a run header, then the routine's prompt (or a pointer back to it). */

import { createHash } from "node:crypto"
import type { WebhookEvent } from "./automation-webhook.ts"
import type { Automation, AutomationRun } from "./contracts.ts"

/** Identifies the prompt text a run delivered, so a standing session can tell when it changed. */
export function routinePromptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16)
}

/**
 * True when a standing session already holds this exact prompt: its newest delivered run
 * went to the same task, into a live engine (`fresh` false), with the same hash.
 * `runs` is newest first; a pruned history reads as "not held", the safe side.
 */
export function sessionHoldsPrompt(
  automation: Pick<Automation, "persistentSession" | "sessionTaskId" | "prompt">,
  runs: readonly Pick<AutomationRun, "status" | "taskId" | "promptHash">[],
  target: { taskId: string; fresh: boolean },
): boolean {
  if (!automation.persistentSession || target.fresh || automation.sessionTaskId !== target.taskId) return false
  const last = runs.find((r) => (r.status === "dispatched" || r.status === "revived") && r.taskId === target.taskId)
  return last?.promptHash === routinePromptHash(automation.prompt)
}

/**
 * A one-line header naming the run and the verb that answers it, then the routine's prompt
 * unchanged, or one line pointing back to it when the session already holds it. The prompt
 * goes LAST: a model replies in the language of the tokens nearest its turn.
 */
export function withRoutineRunHeader(
  automation: Pick<Automation, "name" | "prompt">,
  run: { runNumber: number },
  api: string,
  deliveryId: string,
  event?: WebhookEvent,
  promptHeld = false,
): string {
  const fired = event ? `Fired by webhook: ${event.summary}\n\n` : ""
  const body = promptHeld
    ? "Instructions unchanged from this routine's earlier run in this conversation: follow them again."
    : automation.prompt
  return `[ROVE ROUTINE] "${automation.name}" run #${run.runNumber} — when done, report with: ${api} report --delivery ${deliveryId} --outcome done|partial|blocked|failed --summary … [--evidence …]… [--next …] (only if something happened or you are blocked)\n\n${fired}${body}`
}
