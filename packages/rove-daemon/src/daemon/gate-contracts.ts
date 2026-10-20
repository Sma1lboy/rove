/** Decision gates: a question a task puts to its owner. Re-exported from `contracts.ts`. */

export const GATE_QUESTION_MAX = 500
export const GATE_CONTEXT_MAX = 4000
export const GATE_OPTIONS_MAX = 6

export type GateStatus = "open" | "answered" | "withdrawn"

/** Who answered: the surface, not the person. */
export type GateAnswerSurface = "tui" | "bridge" | "weixin" | "cli"

export interface GateOption {
  readonly key: string
  readonly label: string
  readonly detail?: string
}

export interface GateAnswer {
  readonly option?: string
  readonly text?: string
  readonly by: GateAnswerSurface
  readonly at: string
}

export interface Gate {
  /** `g-<n>`, monotonic per daemon home. */
  readonly id: string
  readonly taskId: string
  /** The tab to answer into; `null` → the task's first engine tab. */
  readonly tabId: string | null
  /** The delivery this gate was raised during. */
  readonly deliveryId?: string
  readonly question: string
  /** Empty = free text only. */
  readonly options: readonly GateOption[]
  readonly recommended?: string
  readonly context?: string
  readonly status: GateStatus
  readonly answer?: GateAnswer
  /** Answer → engine. Absent until the gate is answered. */
  readonly handoff?: "delivered" | "undelivered"
  readonly createdAt: string
}

/** What an Inbox `decision_needed` row carries in `detail.gate`. */
export interface GateInboxDetail {
  readonly id: string
  readonly question: string
  readonly options: readonly GateOption[]
  readonly recommended?: string
  readonly context?: string
  /** The gate is answered but the engine has not received it yet. */
  readonly undelivered?: boolean
}

/** The `gates` push channel payload: gates still needing the owner or the engine. */
export interface GatesPayload {
  readonly gates: Gate[]
}

export function gateInboxKey(gateId: string): string {
  return `\u0000gate\u0000${gateId}`
}
