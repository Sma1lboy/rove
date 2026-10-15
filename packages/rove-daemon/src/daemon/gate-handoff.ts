/**
 * Gate answer → engine. The answer is persisted first (`GatesStore.answer`);
 * delivering it is best-effort and never queued: an answer the engine could
 * not take rides the NEXT prompt delivered to that tab (design/long-run-controls.md § 3).
 */

import type { Gate } from "./gate-contracts.ts"
import type { GatesStore } from "./gates-store.ts"

/** The text pasted into the engine for one answered gate. */
export function formatGateAnswer(gate: Gate): string {
  const lines = [`[ROVE GATE ${gate.id} answered] ${gate.question}`]
  const optionKey = gate.answer?.option
  const label = gate.options.find((o) => o.key === optionKey)?.label
  const text = gate.answer?.text
  if (optionKey !== undefined) {
    lines.push(`Answer: ${optionKey}${label ? ` — ${label}` : ""}`)
    if (text) lines.push(`Note: ${text}`)
  } else if (text) {
    lines.push(`Answer: ${text}`)
  }
  return lines.join("\n")
}

export interface GateHandoff {
  /** Answers to prepend to the prompt, blank-line separated. */
  readonly text: string
  /** Pass to {@link GatesStore.markDelivered} once the prompt actually landed. */
  readonly gateIds: readonly string[]
}

/**
 * Answers still owed to `tabId` of `taskId`, or null. Read-only: mark them
 * delivered only after the prompt carrying them landed, or a failed paste
 * would lose the answer.
 */
export function takeUndeliveredGateAnswers(
  gates: Pick<GatesStore, "undeliveredFor">,
  taskId: string,
  tabId: string | null | undefined,
): GateHandoff | null {
  const owed = gates.undeliveredFor(taskId, tabId)
  if (owed.length === 0) return null
  return { text: owed.map(formatGateAnswer).join("\n\n"), gateIds: owed.map((g) => g.id) }
}

/** The prompt with any owed gate answers in front of it. */
export function withGateAnswers(prompt: string, handoff: GateHandoff | null): string {
  return handoff ? `${handoff.text}\n\n${prompt}` : prompt
}

/** The slice of {@link GatesStore} a delivery path needs to carry owed answers. */
export type GateLedger = Pick<GatesStore, "undeliveredFor" | "markDelivered">

/** `prompt` with owed answers in front; `commit` marks them delivered once it landed. */
export function carryOwedGateAnswers(
  gates: GateLedger | undefined,
  taskId: string,
  tabId: string | null | undefined,
  prompt: string,
): { prompt: string; commit(): Promise<void> } {
  const handoff = gates ? takeUndeliveredGateAnswers(gates, taskId, tabId) : null
  return {
    prompt: withGateAnswers(prompt, handoff),
    commit: async () => {
      if (handoff && gates) await gates.markDelivered(handoff.gateIds)
    },
  }
}
