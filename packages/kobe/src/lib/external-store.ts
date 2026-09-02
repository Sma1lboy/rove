/**
 * Framework-free observable state shared by the Orchestrator, daemon client,
 * and React adapters. A state is callable for compatibility with the former
 * Solid Accessor interface, while `get`/`subscribe` plug directly into
 * `useSyncExternalStore`. There is one cell per semantic stream so unrelated
 * daemon channels do not invalidate each other.
 */

export interface ReadableState<T> {
  (): T
  /** Stable snapshot reader. */
  get(): T
  /** Subscribe to later changes; initial delivery is owned by the caller. */
  subscribe(listener: () => void): () => void
}

export interface StateCell<T> extends ReadableState<T> {
  /** Replace the snapshot and notify when the reference actually changed. */
  set(next: T): void
  /** Functional update over the current snapshot. */
  update(fn: (current: T) => T): void
}

/** Backward-compatible name for callers already using the store vocabulary. */
export type ExternalStore<T> = StateCell<T>

const STATE_CHANGE_LIMIT = 64
const recentStateChanges: string[] = []

function snapshotShape(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return `Array(${value.length})`
  if (value instanceof Map) return `Map(${value.size})`
  if (value instanceof Set) return `Set(${value.size})`
  if (typeof value === "string") return `string(${value.length})`
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "undefined") return String(value)
  if (typeof value === "object") return `Object(${Object.keys(value).length})`
  return typeof value
}

function recordStateChange(label: string, before: unknown, after: unknown): void {
  recentStateChanges.push(`${new Date().toISOString()} ${label}: ${snapshotShape(before)} -> ${snapshotShape(after)}`)
  if (recentStateChanges.length > STATE_CHANGE_LIMIT)
    recentStateChanges.splice(0, recentStateChanges.length - STATE_CHANGE_LIMIT)
}

/** Bounded, content-safe state trace appended to pane-crash diagnostics. */
export function recentStateChangesForDiagnostics(): readonly string[] {
  return recentStateChanges
}

/** Test-only reset for the process-wide diagnostic ring. */
export function clearRecentStateChangesForTest(): void {
  recentStateChanges.length = 0
}

export function createStateCell<T>(initial: T, debugLabel?: string): StateCell<T> {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const state = (() => snapshot) as StateCell<T>
  state.get = state
  state.set = (next: T) => {
    if (Object.is(next, snapshot)) return
    if (debugLabel) recordStateChange(debugLabel, snapshot, next)
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  state.update = (fn) => state.set(fn(snapshot))
  state.subscribe = (listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  return state
}

export const createExternalStore = createStateCell

/** Read-only derived state with the source's notification granularity. */
export function mapReadableState<T, U>(source: ReadableState<T>, map: (value: T) => U): ReadableState<U> {
  const get = () => map(source.get())
  const derived = get as ReadableState<U>
  derived.get = get
  derived.subscribe = source.subscribe
  return derived
}
