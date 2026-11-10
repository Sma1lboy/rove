/**
 * The task list as changes: a client that asks for patches is sent the rows that changed, not the
 * whole list again. At 10,000 tasks the list is 5.9 MB and one token count changes one row.
 * A patch names the revision it starts from (`from`); a client holding another asks for the list again.
 */

import type { TaskRow, TasksPayload } from "./protocol.ts"

export interface RowsPatch {
  readonly upsert: readonly TaskRow[]
  readonly remove: readonly string[]
  /** Every id in order, sent only when a row was added, removed or moved. */
  readonly order?: readonly string[]
}

export interface TasksPatch {
  readonly from: number
  readonly rev: number
  readonly tasks?: RowsPatch
  readonly archived?: RowsPatch
  /** Small lists: sent whole when they changed. */
  readonly attention?: TasksPayload["attention"]
  readonly gates?: TasksPayload["gates"]
}

/** `forMs` ticks on its own; a client ages rows from `since`. */
const keyOf = (value: unknown): string => JSON.stringify(value, (k, v) => (k === "forMs" ? undefined : v))

interface Section {
  readonly keys: ReadonlyMap<string, string>
  readonly order: string
}

/** What a list looked like at one revision, kept to tell the next one's changes. */
export interface PayloadIndex {
  readonly tasks: Section
  readonly archived: Section
  readonly attention: string
  readonly gates: string
}

const section = (rows: readonly TaskRow[]): Section => ({
  keys: new Map(rows.map((row) => [row.id, keyOf(row)])),
  order: rows.map((row) => row.id).join("\n"),
})

export function indexPayload(payload: TasksPayload): PayloadIndex {
  return {
    tasks: section(payload.tasks),
    archived: section(payload.archived ?? []),
    attention: keyOf(payload.attention),
    gates: keyOf(payload.gates ?? []),
  }
}

function diffRows(before: Section, after: Section, rows: readonly TaskRow[]): RowsPatch | undefined {
  const upsert = rows.filter((row) => before.keys.get(row.id) !== after.keys.get(row.id))
  const remove = [...before.keys.keys()].filter((id) => !after.keys.has(id))
  const moved = before.order !== after.order
  if (upsert.length === 0 && remove.length === 0 && !moved) return undefined
  return { upsert, remove, ...(moved ? { order: rows.map((row) => row.id) } : {}) }
}

/** The patch from `before` to `payload`, or null when nothing a client draws changed. */
export function diffPayload(
  before: PayloadIndex,
  after: PayloadIndex,
  payload: TasksPayload,
  from: number,
): TasksPatch | null {
  const tasks = diffRows(before.tasks, after.tasks, payload.tasks)
  const archived = diffRows(before.archived, after.archived, payload.archived ?? [])
  const attention = before.attention !== after.attention
  const gates = before.gates !== after.gates
  if (!tasks && !archived && !attention && !gates) return null
  return {
    from,
    rev: from + 1,
    ...(tasks ? { tasks } : {}),
    ...(archived ? { archived } : {}),
    ...(attention ? { attention: payload.attention } : {}),
    ...(gates ? { gates: payload.gates ?? [] } : {}),
  }
}

function applyRows(rows: readonly TaskRow[], patch: RowsPatch | undefined): readonly TaskRow[] {
  if (!patch) return rows
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const id of patch.remove) byId.delete(id)
  for (const row of patch.upsert) byId.set(row.id, row)
  if (patch.order) return patch.order.flatMap((id) => byId.get(id) ?? [])
  // No order: nothing was added, removed or moved, so each row keeps its place.
  return rows.map((row) => byId.get(row.id) ?? row)
}

export function applyTasksPatch(base: TasksPayload, patch: TasksPatch): TasksPayload {
  return {
    ...base,
    rev: patch.rev,
    tasks: applyRows(base.tasks, patch.tasks),
    ...(patch.archived ? { archived: applyRows(base.archived ?? [], patch.archived) } : {}),
    ...(patch.attention ? { attention: patch.attention } : {}),
    ...(patch.gates ? { gates: patch.gates } : {}),
  }
}

export function isTasksPatch(value: unknown): value is TasksPatch {
  return !!value && typeof value === "object" && typeof (value as TasksPatch).from === "number"
}
