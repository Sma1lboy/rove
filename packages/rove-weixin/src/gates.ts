/**
 * Decision gates over WeChat: list the open ones with their option keys, and answer one.
 *
 *   gates                        → every open decision (`rove api gates`)
 *   answer g-12 b [note]         → option b, optional note (`gate-answer --option b --text …`)
 *   answer g-12 - <text>         → free text on a gate that has options
 *   answer g-12 <text>           → free text on a gate with no options
 */

import type { Gate } from "@sma1lboy/rove-daemon/daemon/contracts"
import { head, shortId } from "./format.ts"

export interface GateAnswer {
  readonly gate: Gate
  readonly option?: string
  readonly text?: string
}

type Parsed = { readonly ok: true; readonly answer: GateAnswer } | { readonly ok: false; readonly reply: string }

export const GATES_USAGE = "Usage: answer g-12 <key> [note]"

function gateLines(gate: Gate, titles: ReadonlyMap<string, string>): string[] {
  const lines = [`${gate.id} ${shortId(gate.taskId)} ${titles.get(gate.taskId) ?? ""}`.trimEnd(), gate.question]
  for (const o of gate.options) {
    const mark = o.key === gate.recommended ? " (recommended)" : ""
    lines.push(`  ${o.key}${mark} — ${o.label}${o.detail ? ` (${o.detail})` : ""}`)
  }
  if (gate.options.length === 0) lines.push("  free text only")
  return lines
}

/** The `gates` reply. */
export function renderGates(gates: readonly Gate[], titles: ReadonlyMap<string, string>): string {
  if (gates.length === 0) return "No open decisions."
  const lines = [`${gates.length} open decision${gates.length === 1 ? "" : "s"}:`]
  for (const gate of gates) lines.push("", ...gateLines(gate, titles))
  lines.push("", GATES_USAGE)
  return lines.join("\n")
}

/** `g-12`, `G-12` or bare `12` → `g-12`; anything else is not a gate reference. */
function gateId(ref: string): string | null {
  const m = /^(?:g-?)?(\d{1,9})$/i.exec(ref)
  return m ? `g-${Number(m[1])}` : null
}

/** Parse `answer <gate> …` against the open gates; the option key is checked here so a typo never reaches the daemon. */
export function parseAnswer(rest: string, open: readonly Gate[]): Parsed {
  const [ref, afterRef] = head(rest)
  if (!ref || !afterRef.trim()) return { ok: false, reply: GATES_USAGE }
  const id = gateId(ref)
  const gate = id ? open.find((g) => g.id === id) : undefined
  if (!gate) {
    return { ok: false, reply: `No open decision "${ref}". Send "gates" for the list.` }
  }
  if (gate.options.length === 0) {
    const [word, note] = head(afterRef)
    const text = (word === "-" ? note : afterRef).trim()
    return text ? { ok: true, answer: { gate, text } } : { ok: false, reply: `Usage: answer ${gate.id} - <text>` }
  }

  const [word, note] = head(afterRef)
  if (word === "-") {
    return note.trim()
      ? { ok: true, answer: { gate, text: note.trim() } }
      : { ok: false, reply: `Usage: answer ${gate.id} - <text>` }
  }
  const option = gate.options.find((o) => o.key.toLowerCase() === word.toLowerCase())
  if (!option) {
    return {
      ok: false,
      reply: `"${word}" is not an option of ${gate.id}. Options: ${gate.options.map((o) => o.key).join(", ")} (or "answer ${gate.id} - <text>").`,
    }
  }
  return { ok: true, answer: { gate, option: option.key, ...(note.trim() ? { text: note.trim() } : {}) } }
}

/** The reply after the daemon took the answer. */
export function answeredReply(answer: GateAnswer, delivered: boolean): string {
  const picked = answer.gate.options.find((o) => o.key === answer.option)
  const what = picked ? `${picked.key} (${picked.label})` : "your text"
  return `Answered ${answer.gate.id} with ${what}. ${
    delivered ? "Sent to the agent." : "The agent is not running; it gets this with the task's next message."
  }`
}
