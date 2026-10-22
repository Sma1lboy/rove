/**
 * A task's terminal tabs as the daemon owns them, and the operations that
 * change them. Pure: the daemon's tab store applies these under its one
 * writer, and a client folds its not-yet-confirmed operations over the last
 * state the daemon sent so its own changes show at once.
 *
 * Rows are opaque beyond `id` / `ordinal` / `kind`: their shape belongs to the
 * TUI (`terminal-tab-shapes.ts`). What the daemon adds is ownership:
 * - ids are minted from ONE counter. A client reserves ordinals ahead of time
 *   (`reserve`), so it can open a tab without waiting and two clients can never
 *   mint the same id.
 * - a closed id is tombstoned, so a stale copy (or the orphan poll seeing a
 *   dying session) cannot open it again.
 * - which tab a client looks at is that client's own; `focus` only records the
 *   last one for a restart.
 */

export interface TabRow {
  readonly id: string
  readonly ordinal: number
  readonly kind: string
  readonly [field: string]: unknown
}

export interface SharedTabs {
  readonly tabs: readonly TabRow[]
  /** Next ordinal the counter hands out; everything below is taken or reserved. */
  readonly nextOrdinal: number
  /** The tab some client focused last: where a fresh client or a restart starts. */
  readonly activeId?: string
  /** Opaque hint for re-seeding a task whose last tab closed (TUI `reopenHintFor`). */
  readonly reopenAs?: unknown
}

export type TabOp =
  /** Seed a task that has no tabs yet (no record, or an empty one); ignored once it has tabs. */
  | { readonly op: "seed"; readonly state: SharedTabs }
  /**
   * Add a row. `row.id` is one this client reserved, a live session's id (orphan
   * adoption), or absent: the daemon mints it. Placed after `after` (null = first,
   * absent or unknown = last). An id that exists or is tombstoned is not opened.
   */
  | {
      readonly op: "open"
      readonly row: Omit<TabRow, "id" | "ordinal"> & { readonly id?: string; readonly ordinal?: number }
      readonly after?: string | null
    }
  /** Change fields of an existing row; a row that is gone stays gone. */
  | {
      readonly op: "patch"
      readonly id: string
      readonly set?: Readonly<Record<string, unknown>>
      readonly unset?: readonly string[]
    }
  | { readonly op: "close"; readonly id: string; readonly reopenAs?: unknown }
  /** Reorder: these ids first in this order; any other row keeps its relative place after them. */
  | { readonly op: "order"; readonly ids: readonly string[] }
  | { readonly op: "focus"; readonly id: string }
  /** Set or clear `reopenAs`. */
  | { readonly op: "meta"; readonly reopenAs?: unknown }
  | { readonly op: "forget" }

export interface ApplyResult {
  /** Null = no record (never opened, or forgotten). */
  readonly state: SharedTabs | null
  readonly changed: boolean
  /** Ids each `open` produced, in op order (null where the open was refused). */
  readonly opened: readonly (string | null)[]
}

const ID_RE = /^tab-(\d+)$/

/** `tab-7` → 7; null for an id the counter did not mint. */
export function tabOrdinalOf(id: string): number | null {
  const match = ID_RE.exec(id)
  return match ? Number(match[1]) : null
}

const sameValue = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)

function insertAfter(tabs: readonly TabRow[], row: TabRow, after: string | null | undefined): TabRow[] {
  if (after === null) return [row, ...tabs]
  const i = after === undefined ? -1 : tabs.findIndex((t) => t.id === after)
  return i < 0 ? [...tabs, row] : [...tabs.slice(0, i + 1), row, ...tabs.slice(i + 1)]
}

/**
 * Apply `ops` in order. `tombstones` is the store's set of closed ids for this
 * task (mutated: a close adds to it); a client folding its own pending ops
 * passes an empty set.
 */
export function applyTabOps(
  current: SharedTabs | null,
  ops: readonly TabOp[],
  tombstones: Set<string> = new Set(),
): ApplyResult {
  let state = current
  let changed = false
  const opened: (string | null)[] = []
  const set = (next: SharedTabs | null): void => {
    state = next
    changed = true
  }
  for (const op of ops) {
    switch (op.op) {
      case "seed": {
        // An empty record counts as none: a reservation alone creates one before any tab exists.
        if (state === null || state.tabs.length === 0) {
          const floor = Math.max(op.state.nextOrdinal, maxOrdinal(op.state) + 1, state?.nextOrdinal ?? 0)
          set({ ...op.state, nextOrdinal: floor })
        }
        break
      }
      case "forget": {
        if (state !== null) set(null)
        break
      }
      case "open": {
        const base = state ?? { tabs: [], nextOrdinal: 1 }
        const wanted = op.row.id
        if (wanted !== undefined && (base.tabs.some((t) => t.id === wanted) || tombstones.has(wanted))) {
          opened.push(null)
          break
        }
        const ordinal =
          wanted !== undefined ? (tabOrdinalOf(wanted) ?? op.row.ordinal ?? base.nextOrdinal) : base.nextOrdinal
        const id = wanted ?? `tab-${ordinal}`
        const row = { ...op.row, id, ordinal } as TabRow
        set({
          ...base,
          tabs: insertAfter(base.tabs, row, op.after),
          nextOrdinal: Math.max(base.nextOrdinal, ordinal + 1),
        })
        opened.push(id)
        break
      }
      case "patch": {
        if (!state) break
        const i = state.tabs.findIndex((t) => t.id === op.id)
        const row = state.tabs[i]
        if (!row) break
        const next: Record<string, unknown> = { ...row }
        let rowChanged = false
        for (const [key, value] of Object.entries(op.set ?? {})) {
          if (key === "id" || key === "ordinal" || sameValue(next[key], value)) continue
          next[key] = value
          rowChanged = true
        }
        for (const key of op.unset ?? []) {
          if (key === "id" || key === "ordinal" || key === "kind" || !(key in next)) continue
          delete next[key]
          rowChanged = true
        }
        if (!rowChanged) break
        const tabs = [...state.tabs]
        tabs[i] = next as TabRow
        set({ ...state, tabs })
        break
      }
      case "close": {
        if (!state || !state.tabs.some((t) => t.id === op.id)) break
        tombstones.add(op.id)
        const tabs = state.tabs.filter((t) => t.id !== op.id)
        const reopen = tabs.length === 0 && op.reopenAs !== undefined ? { reopenAs: op.reopenAs } : {}
        const { activeId, ...rest } = state
        set({ ...rest, tabs, ...(activeId !== undefined && activeId !== op.id ? { activeId } : {}), ...reopen })
        break
      }
      case "order": {
        if (!state) break
        const byId = new Map(state.tabs.map((t) => [t.id, t]))
        const first = op.ids.flatMap((id) => {
          const row = byId.get(id)
          if (!row) return []
          byId.delete(id)
          return [row]
        })
        const tabs = [...first, ...state.tabs.filter((t) => byId.has(t.id))]
        if (tabs.every((t, i) => t === state?.tabs[i])) break
        set({ ...state, tabs })
        break
      }
      case "focus": {
        if (!state || state.activeId === op.id || !state.tabs.some((t) => t.id === op.id)) break
        set({ ...state, activeId: op.id })
        break
      }
      case "meta": {
        if (!state || sameValue(state.reopenAs, op.reopenAs)) break
        const { reopenAs: _drop, ...rest } = state
        set(op.reopenAs === undefined ? rest : { ...rest, reopenAs: op.reopenAs })
        break
      }
    }
  }
  return { state, changed, opened }
}

function maxOrdinal(state: SharedTabs): number {
  return state.tabs.reduce((max, tab) => Math.max(max, tab.ordinal), 0)
}

/** Reserve `count` ordinals: [from, from + count). The caller persists the bumped counter. */
export function reserveOrdinals(state: SharedTabs | null, count: number): { state: SharedTabs; from: number } {
  const base = state ?? { tabs: [], nextOrdinal: 1 }
  const from = Math.max(base.nextOrdinal, maxOrdinal(base) + 1)
  return { state: { ...base, nextOrdinal: from + count }, from }
}

/** Give back unused ordinals [from, to) when nothing above them was handed out, keeping numbering dense. */
export function releaseOrdinals(state: SharedTabs | null, from: number, to: number): SharedTabs | null {
  if (!state || state.nextOrdinal !== to || from >= to) return state
  const floor = Math.max(from, maxOrdinal(state) + 1)
  return floor < state.nextOrdinal ? { ...state, nextOrdinal: floor } : state
}

/**
 * The ops that turn `prev` into `next` (a client edited its copy with the TUI's
 * reducers). New rows → open (placed after their left neighbour), gone rows →
 * close, changed fields → patch, a changed relative order → order. `activeId`
 * and `nextOrdinal` are the client's own and never diffed.
 */
export function diffTabs(prev: SharedTabs | null, next: SharedTabs): TabOp[] {
  if (prev === null) return [{ op: "seed", state: next }]
  const ops: TabOp[] = []
  const prevById = new Map(prev.tabs.map((t) => [t.id, t]))
  const nextIds = new Set(next.tabs.map((t) => t.id))
  for (const row of prev.tabs) {
    // The last close carries the re-seed hint the client's reducer computed.
    const reopen = next.tabs.length === 0 && next.reopenAs !== undefined ? { reopenAs: next.reopenAs } : {}
    if (!nextIds.has(row.id)) ops.push({ op: "close", id: row.id, ...reopen })
  }
  next.tabs.forEach((row, i) => {
    const before = prevById.get(row.id)
    if (!before) {
      ops.push({ op: "open", row, after: i === 0 ? null : (next.tabs[i - 1]?.id ?? null) })
      return
    }
    if (before === row) return
    const set: Record<string, unknown> = {}
    const unset: string[] = []
    for (const [key, value] of Object.entries(row)) {
      if (key !== "id" && key !== "ordinal" && !sameValue(before[key], value)) set[key] = value
    }
    for (const key of Object.keys(before)) if (!(key in row)) unset.push(key)
    if (Object.keys(set).length > 0 || unset.length > 0) {
      ops.push({
        op: "patch",
        id: row.id,
        ...(Object.keys(set).length > 0 ? { set } : {}),
        ...(unset.length > 0 ? { unset } : {}),
      })
    }
  })
  const kept = next.tabs.filter((t) => prevById.has(t.id)).map((t) => t.id)
  const prevKept = prev.tabs.filter((t) => nextIds.has(t.id)).map((t) => t.id)
  if (kept.some((id, i) => id !== prevKept[i])) ops.push({ op: "order", ids: next.tabs.map((t) => t.id) })
  if (!sameValue(prev.reopenAs, next.reopenAs) && next.tabs.length > 0)
    ops.push({ op: "meta", reopenAs: next.reopenAs })
  return ops
}
