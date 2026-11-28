/**
 * Shared `--event` / `--event-*` flag definitions and payload builders for
 * `routine-create` and `routine-update`. Mirrors `routine-engine-fields.ts` so
 * `verbs-automations.ts` stays focused on verb wiring.
 */

import {
  AUTOMATION_EVENT_KINDS,
  type AutomationEventFilter,
  type AutomationEventKind,
  type AutomationEventTrigger,
  isAutomationEventKind,
} from "@sma1lboy/rove-daemon/daemon/contracts"
import { ApiError, type FlagSpec, type VerbContext } from "./types.ts"

const KIND_LIST = AUTOMATION_EVENT_KINDS.join(", ")

export const EVENT_FLAGS: readonly FlagSpec[] = [
  {
    name: "event",
    type: "csv",
    placeholder: "KIND[,KIND…]",
    description: `Event trigger source(s) (${KIND_LIST}). Works alone (pure event-driven routine, no --schedule) or alongside --schedule (hybrid). '' on update clears event triggers.`,
  },
  {
    name: "event-branch",
    type: "string",
    placeholder: "GLOB",
    description: "Optional branch filter (exact or *-glob, e.g. 'main', 'release/*') applied to --event triggers.",
  },
  {
    name: "event-name",
    type: "string",
    placeholder: "NAME",
    description: "Optional event-name filter (e.g. 'issues', 'deploy.*') applied to webhook/local --event triggers.",
  },
  {
    name: "event-action",
    type: "string",
    placeholder: "ACTION",
    description: "Optional action filter (e.g. 'opened', 'review_requested') applied to --event triggers.",
  },
]

function parseEventKinds(raw: string): AutomationEventKind[] {
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) {
    throw new ApiError(`--event must list at least one kind (${KIND_LIST})`, "BAD_FLAG")
  }
  const seen = new Set<AutomationEventKind>()
  for (const part of parts) {
    if (!isAutomationEventKind(part)) {
      throw new ApiError(`--event kind "${part}" must be one of ${KIND_LIST}`, "BAD_FLAG")
    }
    seen.add(part)
  }
  return [...seen]
}

function readEventFilter(ctx: VerbContext): AutomationEventFilter | undefined {
  const branch = ctx.args.str("event-branch")
  const event = ctx.args.str("event-name")
  const action = ctx.args.str("event-action")
  if (!branch && !event && !action) return undefined
  return {
    ...(branch ? { branch } : {}),
    ...(event ? { event } : {}),
    ...(action ? { action } : {}),
  }
}

/**
 * Build `{ eventTriggers }` from `--event` and `--event-*`.
 * On update, `--event ''` sends `{ eventTriggers: null }` to clear.
 * Passing `--event-branch`/`--event-name`/`--event-action` without `--event` is refused so filters are never dropped.
 */
export function eventTriggersPayload(ctx: VerbContext): { eventTriggers?: AutomationEventTrigger[] | null } {
  const hasFilter =
    ctx.args.present("event-branch") || ctx.args.present("event-name") || ctx.args.present("event-action")
  if (!ctx.args.present("event")) {
    if (hasFilter) {
      throw new ApiError("--event-branch, --event-name and --event-action require --event", "BAD_FLAG")
    }
    return {}
  }
  const raw = ctx.args.str("event")
  if (raw === undefined) {
    if (hasFilter) {
      throw new ApiError("cannot combine --event '' (clear) with --event-* filters", "BAD_FLAG")
    }
    return { eventTriggers: null }
  }
  const kinds = parseEventKinds(raw)
  const filter = readEventFilter(ctx)
  return {
    eventTriggers: kinds.map((kind) => (filter ? { kind, filter } : { kind })),
  }
}
