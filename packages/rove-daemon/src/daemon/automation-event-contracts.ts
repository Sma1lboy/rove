/**
 * Event-trigger contracts for Routines: trigger kinds, filter matching,
 * mode derivation (`schedule` vs `event` vs `hybrid`), and formatting helpers.
 * Pure (no fs/network/orchestrator imports) so daemon, API, core, TUI and web share one contract.
 */

export const AUTOMATION_EVENT_KINDS = ["ci_failed", "pr_review_requested", "issue_opened", "webhook", "local"] as const

export type AutomationEventKind = (typeof AUTOMATION_EVENT_KINDS)[number]

/** High-level routine trigger mode, derived from schedule + eventTriggers/webhook. */
export type AutomationTriggerMode = "schedule" | "event" | "hybrid"

/** Optional predicates narrowing when an event trigger fires a routine. */
export interface AutomationEventFilter {
  /** Branch name or `*`-glob (e.g. `main`, `release/*`). */
  readonly branch?: string
  /** Event name or `*`-glob (e.g. `issues`, `pull_request`, `deploy.*`). */
  readonly event?: string
  /** Event action or `*`-glob (e.g. `opened`, `reopened`, `changes_requested`). */
  readonly action?: string
}

/** One event trigger rule attached to a routine. */
export interface AutomationEventTrigger {
  readonly kind: AutomationEventKind
  readonly filter?: AutomationEventFilter
}

/** What fired an event or webhook run, as precheck env, prompt header and run history see it. */
export interface AutomationTriggerEvent {
  readonly kind?: AutomationEventKind
  /** Event name (`X-GitHub-Event` for webhooks, or the event kind/custom hook name). */
  readonly name: string
  readonly action?: string
  readonly branch?: string
  readonly repo?: string
  readonly url?: string
  readonly detail?: string
  /** One-line summary stored on the run and prefixed to the delivered prompt. */
  readonly summary: string
}

export function isAutomationEventKind(value: unknown): value is AutomationEventKind {
  return typeof value === "string" && (AUTOMATION_EVENT_KINDS as readonly string[]).includes(value)
}

/** Derive `schedule` vs `event` vs `hybrid` from a routine's configured triggers. */
export function automationTriggerMode(automation: {
  readonly schedule?: string
  readonly eventTriggers?: readonly AutomationEventTrigger[]
  readonly webhook?: { readonly secret: string }
}): AutomationTriggerMode {
  const hasSchedule = Boolean(automation.schedule)
  const hasEvent = hasAutomationEventTrigger(automation)
  if (hasSchedule && hasEvent) return "hybrid"
  if (hasEvent) return "event"
  return "schedule"
}

/** True when a routine has at least one event trigger or an enabled webhook. */
export function hasAutomationEventTrigger(automation: {
  readonly eventTriggers?: readonly AutomationEventTrigger[]
  readonly webhook?: { readonly secret: string }
}): boolean {
  return Boolean((automation.eventTriggers && automation.eventTriggers.length > 0) || automation.webhook)
}

/** True when any event trigger wants a webhook endpoint (`/hooks/routines/<id>`). */
export function triggersWantWebhook(triggers: readonly AutomationEventTrigger[] | undefined): boolean {
  return Boolean(triggers?.some((t) => t.kind === "webhook" || t.kind === "issue_opened"))
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeFilter(value: unknown): AutomationEventFilter | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const branch = nonEmpty(raw.branch)
  const event = nonEmpty(raw.event)
  const action = nonEmpty(raw.action)
  if (!branch && !event && !action) return undefined
  return {
    ...(branch ? { branch } : {}),
    ...(event ? { event } : {}),
    ...(action ? { action } : {}),
  }
}

/** Tolerant on-disk loader for `Automation.eventTriggers`; drops malformed entries. */
export function normalizeEventTriggers(value: unknown): AutomationEventTrigger[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: AutomationEventTrigger[] = []
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    if (!isAutomationEventKind(raw.kind)) continue
    const filter = normalizeFilter(raw.filter)
    out.push(filter ? { kind: raw.kind, filter } : { kind: raw.kind })
  }
  return out.length > 0 ? out : undefined
}

/** Strict RPC/API validator for `eventTriggers` (null clears; array validates every element). */
export function parseEventTriggers(value: unknown): AutomationEventTrigger[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) throw new Error("eventTriggers must be an array or null")
  const out: AutomationEventTrigger[] = []
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("each event trigger must be an object with { kind, filter? }")
    }
    const raw = item as Record<string, unknown>
    if (!isAutomationEventKind(raw.kind)) {
      throw new Error(`event trigger kind must be one of ${AUTOMATION_EVENT_KINDS.join(", ")}`)
    }
    if (
      raw.filter !== undefined &&
      (typeof raw.filter !== "object" || raw.filter === null || Array.isArray(raw.filter))
    ) {
      throw new Error("event trigger filter must be an object")
    }
    const filter = normalizeFilter(raw.filter)
    out.push(filter ? { kind: raw.kind, filter } : { kind: raw.kind })
  }
  return out
}

/** Simple `*`-wildcard matcher (no regex backtracking). */
export function globMatch(pattern: string, value: string): boolean {
  if (pattern === "*") return true
  const parts = pattern.split("*")
  if (parts.length === 1) return pattern === value
  let pos = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? ""
    if (i === 0) {
      if (!value.startsWith(part)) return false
      pos = part.length
    } else if (i === parts.length - 1) {
      if (!value.endsWith(part)) return false
      if (value.length - part.length < pos) return false
    } else {
      const idx = value.indexOf(part, pos)
      if (idx === -1) return false
      pos = idx + part.length
    }
  }
  return true
}

/** True when `event` satisfies every populated field of `filter`. */
export function matchEventFilter(
  filter: AutomationEventFilter | undefined,
  event: Pick<AutomationTriggerEvent, "name" | "action" | "branch">,
): boolean {
  if (!filter) return true
  if (filter.branch && (!event.branch || !globMatch(filter.branch, event.branch))) return false
  if (filter.event && !globMatch(filter.event, event.name)) return false
  if (filter.action && (!event.action || !globMatch(filter.action, event.action))) return false
  return true
}

/** True when a non-webhook daemon/local event matches `trigger`. */
export function matchEventTrigger(trigger: AutomationEventTrigger, event: AutomationTriggerEvent): boolean {
  if (event.kind !== trigger.kind) return false
  return matchEventFilter(trigger.filter, event)
}

/** Env vars exposed to a routine's precheck and script when fired by an event or webhook. */
export function eventPrecheckEnv(event: AutomationTriggerEvent, trigger: "webhook" | "event"): Record<string, string> {
  return {
    ROVE_EVENT_KIND: event.kind ?? trigger,
    ROVE_EVENT_NAME: event.name,
    ROVE_EVENT_ACTION: event.action ?? "",
    ROVE_EVENT_BRANCH: event.branch ?? "",
    ROVE_EVENT_URL: event.url ?? "",
    ROVE_EVENT_SUMMARY: event.summary,
    ...(trigger === "webhook"
      ? {
          ROVE_WEBHOOK_EVENT: event.name,
          ROVE_WEBHOOK_ACTION: event.action ?? "",
        }
      : {}),
  }
}

/** Compact one-trigger description, e.g. `ci_failed (main)` or `webhook (issues.opened)`. */
export function formatEventTrigger(trigger: AutomationEventTrigger): string {
  const f = trigger.filter
  if (!f) return trigger.kind
  const parts: string[] = []
  if (f.event) parts.push(f.action ? `${f.event}.${f.action}` : f.event)
  else if (f.action) parts.push(f.action)
  if (f.branch) parts.push(f.branch)
  return parts.length > 0 ? `${trigger.kind} (${parts.join(", ")})` : trigger.kind
}

/** Compact summary of all event triggers (and bare webhook) on a routine. */
export function formatEventTriggers(automation: {
  readonly eventTriggers?: readonly AutomationEventTrigger[]
  readonly webhook?: { readonly secret: string }
}): string {
  const list = automation.eventTriggers?.map(formatEventTrigger) ?? []
  if (list.length > 0) return list.join(", ")
  return automation.webhook ? "webhook" : ""
}
