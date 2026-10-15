/**
 * Durable decision gates (`<ROVE_HOME>/.rove/gates.json`): a question a task
 * puts to its owner. The daemon is the only writer. Open gates, and answered
 * ones the engine has not received yet, are never pruned; closed ones keep
 * the newest {@link MAX_CLOSED_GATES}.
 */

import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { ROVE_STATE_DIR_BASENAME, readRoveHomeDirEnv } from "../compat-env.ts"
import type { AttentionInboxItem } from "./attention-contracts.ts"
import {
  GATE_CONTEXT_MAX,
  GATE_OPTIONS_MAX,
  GATE_QUESTION_MAX,
  type Gate,
  type GateAnswerSurface,
  type GateInboxDetail,
  type GateOption,
  type GateStatus,
} from "./gate-contracts.ts"
import { serialized, writeJsonAtomic } from "./json-file.ts"

/** Closed (withdrawn, or answered and received) gates kept after pruning. */
export const MAX_CLOSED_GATES = 200

const GATE_ANSWER_TEXT_MAX = 4000
const OPTION_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/

interface GatesFile {
  version: 1
  nextId: number
  gates: Gate[]
}

export function defaultGatesStorePath(homeDir = readRoveHomeDirEnv() ?? homedir()): string {
  return join(homeDir, ROVE_STATE_DIR_BASENAME, "gates.json")
}

export interface RaiseGateInput {
  readonly taskId: string
  readonly tabId?: string | null
  readonly deliveryId?: string
  readonly question: string
  readonly options?: readonly GateOption[]
  readonly recommended?: string
  readonly context?: string
}

export interface GateFilter {
  readonly taskId?: string
  readonly status?: GateStatus | "all"
}

function isClosed(gate: Gate): boolean {
  return gate.status === "withdrawn" || (gate.status === "answered" && gate.handoff !== "undelivered")
}

/** Still live: waiting on the owner, or answered but not yet in the engine's hands. */
const isWithdrawable = (gate: Gate): boolean =>
  gate.status === "open" || (gate.status === "answered" && gate.handoff === "undelivered")

/** A canonical tab stands in for "no tab named": the task's first engine tab. */
const norm = (tabId: string | null | undefined): string => tabId ?? "tab-1"

function normalizeGate(value: unknown): Gate | null {
  if (!value || typeof value !== "object") return null
  const g = value as Partial<Gate>
  if (typeof g.id !== "string" || typeof g.taskId !== "string" || typeof g.question !== "string") return null
  if (g.status !== "open" && g.status !== "answered" && g.status !== "withdrawn") return null
  if (typeof g.createdAt !== "string") return null
  return { ...(g as Gate), tabId: typeof g.tabId === "string" ? g.tabId : null, options: g.options ?? [] }
}

async function readStore(path: string): Promise<GatesFile | null> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, nextId: 1, gates: [] }
    throw err
  }
  const parsed = JSON.parse(text) as Partial<GatesFile>
  if (!Array.isArray(parsed.gates)) return null
  const gates = parsed.gates.map(normalizeGate).filter((g): g is Gate => g !== null)
  const maxSeen = gates.reduce((m, g) => Math.max(m, Number(g.id.slice(2)) || 0), 0)
  return { version: 1, nextId: Math.max(parsed.nextId ?? 1, maxSeen + 1), gates }
}

function validateRaise(input: RaiseGateInput): { options: GateOption[]; question: string } {
  const question = input.question.trim()
  if (question.length === 0) throw new Error("question is required")
  if (question.length > GATE_QUESTION_MAX) throw new Error(`question is over ${GATE_QUESTION_MAX} characters`)
  if (input.context !== undefined && input.context.length > GATE_CONTEXT_MAX)
    throw new Error(`context is over ${GATE_CONTEXT_MAX} characters`)
  const options = [...(input.options ?? [])]
  if (options.length > GATE_OPTIONS_MAX) throw new Error(`at most ${GATE_OPTIONS_MAX} options`)
  const keys = new Set<string>()
  for (const option of options) {
    if (!OPTION_KEY.test(option.key)) throw new Error(`option key ${JSON.stringify(option.key)} must be a short word`)
    if (keys.has(option.key)) throw new Error(`duplicate option key ${option.key}`)
    if (option.label.trim().length === 0) throw new Error(`option ${option.key} needs a label`)
    keys.add(option.key)
  }
  if (input.recommended !== undefined && !keys.has(input.recommended))
    throw new Error(`recommended ${JSON.stringify(input.recommended)} is not one of the options`)
  return { options, question }
}

export class GatesStore {
  private gates: Gate[] = []
  private nextId = 1
  /** False until one read SUCCEEDED; writes refuse before that. */
  private loaded = false
  private onChange: () => void = () => {}

  constructor(
    private readonly path: string,
    private readonly now = () => new Date(),
  ) {}

  /** Called after every committed change (the daemon republishes channel + Inbox). */
  setOnChange(fn: () => void): void {
    this.onChange = fn
  }

  async init(): Promise<void> {
    await this.enqueue(async () => {
      const file = await readStore(this.path)
      if (!file) throw new Error(`gates store unreadable (${this.path}) — refusing to overwrite it`)
      this.gates = file.gates
      this.nextId = file.nextId
      this.loaded = true
      this.onChange()
    })
  }

  get(id: string): Gate | undefined {
    return this.gates.find((g) => g.id === id)
  }

  list(filter: GateFilter = {}): Gate[] {
    const status = filter.status ?? "open"
    return this.gates.filter(
      (g) => (filter.taskId === undefined || g.taskId === filter.taskId) && (status === "all" || g.status === status),
    )
  }

  /** What still needs the owner or the engine: the `gates` channel payload. */
  active(): Gate[] {
    return this.gates.filter((g) => !isClosed(g))
  }

  /**
   * One `decision_needed` row per active gate. A projection: recomputed on
   * every snapshot, never stored in attention-inbox.json, so no episode
   * cleanup can touch it.
   */
  inboxItems(): AttentionInboxItem[] {
    return this.active().map((g) => {
      const detail: GateInboxDetail = {
        id: g.id,
        question: g.question,
        options: g.options,
        ...(g.recommended ? { recommended: g.recommended } : {}),
        ...(g.context ? { context: g.context } : {}),
        ...(g.status === "answered" ? { undelivered: true } : {}),
      }
      return {
        taskId: g.taskId,
        tabId: g.tabId,
        state: "decision_needed",
        detail: { gate: detail },
        unread: true,
        at: Date.parse(g.createdAt),
      }
    })
  }

  async raise(input: RaiseGateInput): Promise<Gate> {
    const { options, question } = validateRaise(input)
    return await this.mutate((gates) => {
      const gate: Gate = {
        id: `g-${this.nextId}`,
        taskId: input.taskId,
        tabId: input.tabId ?? null,
        ...(input.deliveryId ? { deliveryId: input.deliveryId } : {}),
        question,
        options,
        ...(input.recommended ? { recommended: input.recommended } : {}),
        ...(input.context ? { context: input.context } : {}),
        status: "open",
        createdAt: this.now().toISOString(),
      }
      this.nextId += 1
      return { gates: [...gates, gate], result: gate }
    })
  }

  /** Persist the answer as `undelivered`; the caller delivers, then {@link markDelivered}. */
  async answer(id: string, input: { option?: string; text?: string; by: GateAnswerSurface }): Promise<Gate> {
    const text = input.text?.trim() || undefined
    if (input.option === undefined && text === undefined) throw new Error("answer needs an option or text")
    if (text !== undefined && text.length > GATE_ANSWER_TEXT_MAX)
      throw new Error(`text is over ${GATE_ANSWER_TEXT_MAX} characters`)
    return await this.mutate((gates) => {
      const gate = gates.find((g) => g.id === id)
      if (!gate) throw new Error(`GATE_NOT_FOUND: no gate ${id}`)
      if (gate.status !== "open") throw new Error(`GATE_NOT_OPEN: ${id} is already ${gate.status}`)
      if (input.option !== undefined && !gate.options.some((o) => o.key === input.option)) {
        const keys = gate.options.map((o) => o.key).join(", ")
        throw new Error(
          `BAD_OPTION: ${JSON.stringify(input.option)} is not an option of ${id}${keys ? ` (${keys})` : " (free text only)"}`,
        )
      }
      const next: Gate = {
        ...gate,
        status: "answered",
        handoff: "undelivered",
        answer: {
          ...(input.option !== undefined ? { option: input.option } : {}),
          ...(text !== undefined ? { text } : {}),
          by: input.by,
          at: this.now().toISOString(),
        },
      }
      return { gates: gates.map((g) => (g === gate ? next : g)), result: next }
    })
  }

  /** Record the delivery a raised gate reported blocked. */
  async attachDelivery(id: string, deliveryId: string): Promise<Gate> {
    return await this.mutate((gates) => {
      const gate = gates.find((g) => g.id === id)
      if (!gate) throw new Error(`GATE_NOT_FOUND: no gate ${id}`)
      const next: Gate = { ...gate, deliveryId }
      return { gates: gates.map((g) => (g === gate ? next : g)), result: next }
    })
  }

  /**
   * The owner's explicit close: an open gate, or an answered one the engine
   * never received. Either ends `withdrawn`; a delivered one is already done.
   */
  async withdraw(id: string): Promise<Gate> {
    return await this.mutate((gates) => {
      const gate = gates.find((g) => g.id === id)
      if (!gate) throw new Error(`GATE_NOT_FOUND: no gate ${id}`)
      if (!isWithdrawable(gate))
        throw new Error(`GATE_NOT_OPEN: ${id} is already ${gate.status === "answered" ? "delivered" : gate.status}`)
      const next: Gate = { ...gate, status: "withdrawn" }
      return { gates: gates.map((g) => (g === gate ? next : g)), result: next }
    })
  }

  /** Task deletion: nothing can answer into, or deliver to, a deleted task. */
  async withdrawTask(taskId: string): Promise<void> {
    await this.mutate((gates) => {
      const hit = (g: Gate) => g.taskId === taskId && isWithdrawable(g)
      if (!gates.some(hit)) return { result: undefined }
      return { gates: gates.map((g): Gate => (hit(g) ? { ...g, status: "withdrawn" } : g)), result: undefined }
    })
  }

  /** Answered gates the engine has not received that ride a delivery to `tabId`. */
  undeliveredFor(taskId: string, tabId: string | null | undefined): Gate[] {
    return this.gates.filter(
      (g) =>
        g.taskId === taskId && g.status === "answered" && g.handoff === "undelivered" && norm(g.tabId) === norm(tabId),
    )
  }

  async markDelivered(ids: readonly string[]): Promise<void> {
    await this.mutate((gates) => {
      const hit = (g: Gate) => ids.includes(g.id) && g.status === "answered" && g.handoff === "undelivered"
      if (!gates.some(hit)) return { result: undefined }
      return {
        gates: gates.map((g): Gate => (hit(g) ? { ...g, handoff: "delivered" } : g)),
        result: undefined,
      }
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return serialized(this.path, operation)
  }

  /** Run `fn` on the current gates; when it returns new ones, prune, write, then announce. */
  private async mutate<T>(fn: (gates: readonly Gate[]) => { gates?: Gate[]; result: T }): Promise<T> {
    const outcome = await this.enqueue(async () => {
      // Never write a file we could not read: it would erase every pending decision.
      if (!this.loaded) throw new Error(`gates store never loaded (${this.path}) — refusing to overwrite it`)
      const { gates, result } = fn(this.gates)
      if (!gates) return { result, changed: false }
      const closed = gates.filter(isClosed)
      const dropped = new Set(closed.slice(0, Math.max(0, closed.length - MAX_CLOSED_GATES)))
      const kept = gates.filter((g) => !dropped.has(g))
      const body: GatesFile = { version: 1, nextId: this.nextId, gates: kept }
      await writeJsonAtomic(this.path, body)
      this.gates = kept
      return { result, changed: true }
    })
    if (outcome.changed) this.onChange()
    return outcome.result
  }
}
