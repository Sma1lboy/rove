/**
 * Optimistic sidebar-activity overlay: the keystroke that triggers or
 * interrupts a turn is visible LOCALLY before the hook round trip confirms it.
 *
 * The marks are deliberately asymmetric:
 * - `running` (enter) is a GUESS about the future; a short TTL self-heals an
 *   enter on an empty composer.
 * - `interrupted` (esc) is a FACT about the past: authoritative state stamped
 *   before it stays suppressed until a newer event. Its TTL is only a memory
 *   bound, because esc during `/compact` sends no Stop hook, so a decaying
 *   suppression would resurface the stale `running`.
 *
 * Feeds the ICON only; no label text derives from a mark.
 */

import type { TaskEngineState } from "../../client/remote-orchestrator-payloads"
import { createStateCell } from "../../lib/external-store"

export type OptimisticMark = { readonly kind: "running" | "interrupted"; readonly at: number }

/** Enter-guess lifetime: hooks usually confirm in <1s; decay if they never do. */
const RUNNING_TTL_MS = 5_000
/**
 * Answering a QUESTION: an AskUserQuestion answer resumes the SAME turn, so no
 * hook fires, and `permission_needed` is sticky by design. An enter AT such a
 * tab is therefore a fact ("answered at T") that suppresses the stale state
 * until a newer event, not a 5s guess.
 */
const ANSWERED_TTL_MS = 30 * 60_000
/** Memory bound only; correctness comes from supersession. */
const INTERRUPTED_TTL_MS = 30 * 60_000

const cell = createStateCell<ReadonlyMap<string, OptimisticMark>>(new Map())
let pruneTimer: ReturnType<typeof setTimeout> | null = null

/** The overlay store — `useAccessor(optimisticActivityStore)` in the host. */
export const optimisticActivityStore = cell

function ttlFor(mark: OptimisticMark): number {
  return mark.kind === "running" ? RUNNING_TTL_MS : INTERRUPTED_TTL_MS
}

function prune(): void {
  pruneTimer = null
  const now = Date.now()
  let next: Map<string, OptimisticMark> | null = null
  let soonest = Number.POSITIVE_INFINITY
  for (const [taskId, mark] of cell.get()) {
    const expiresAt = mark.at + ttlFor(mark)
    if (expiresAt <= now) {
      next ??= new Map(cell.get())
      next.delete(taskId)
    } else if (expiresAt < soonest) soonest = expiresAt
  }
  if (next) cell.set(next)
  if (soonest < Number.POSITIVE_INFINITY) pruneTimer = setTimeout(prune, soonest - now + 20)
}

function put(taskId: string, kind: OptimisticMark["kind"]): void {
  const next = new Map(cell.get())
  next.set(taskId, { kind, at: Date.now() })
  cell.set(next)
  if (pruneTimer) clearTimeout(pruneTimer)
  pruneTimer = setTimeout(prune, RUNNING_TTL_MS + 20)
}

/** Drop a task's mark — an authoritative event superseded it. */
export function clearOptimisticMark(taskId: string): void {
  if (!cell.get().has(taskId)) return
  const next = new Map(cell.get())
  next.delete(taskId)
  cell.set(next)
}

/** One raw ENGINE-tab write: enter (`\r`, or a paste ending in one) = turn
 *  triggered; a bare `\x1b` (not CSI/arrows) = interrupted. */
export function noteEngineInput(taskId: string, data: string): void {
  if (data === "\r" || data.endsWith("\r")) put(taskId, "running")
  else if (data === "\x1b") put(taskId, "interrupted")
}

/** Per-TAB answer marks, keyed `taskId::tabId`: the stranded badge is the
 *  TAB's, which the last-event-wins task overlay can't reach. */
const answered = createStateCell<ReadonlyMap<string, number>>(new Map())

export const answeredTabsStore = answered

const tabKey = (taskId: string, tabId: string): string => `${taskId}::${tabId}`

/** Records WHEN the user answered. Only for a tab showing `permission_needed`:
 *  an enter elsewhere is an ordinary submit. */
function noteQuestionAnswered(taskId: string, tabId: string): void {
  const next = new Map(answered.get())
  next.set(tabKey(taskId, tabId), Date.now())
  answered.set(next)
}

/** Routes a write to the task-level mark, plus the answer mark when this tab waits on the user. */
export function noteEngineTabInput(data: string, taskId: string, tabId: string, tabState?: string): void {
  noteEngineInput(taskId, data)
  if ((data === "\r" || data.endsWith("\r")) && tabState === "permission_needed") {
    noteQuestionAnswered(taskId, tabId)
  }
}

/** Suppress ONLY `permission_needed` on the exact answered tab until a newer
 *  event; a local guess must never hide a real error or rate-limit badge. Pure. */
export function mergeAnsweredTabs(
  tabs: ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>>,
  marks: ReadonlyMap<string, number>,
  now: number = Date.now(),
): ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>> {
  if (marks.size === 0) return tabs
  let out: Map<string, ReadonlyMap<string, TaskEngineState>> | null = null
  for (const [key, at] of marks) {
    if (now - at > ANSWERED_TTL_MS) continue
    const sep = key.lastIndexOf("::")
    if (sep === -1) continue
    const taskId = key.slice(0, sep)
    const tabId = key.slice(sep + 2)
    const perTab = (out ?? tabs).get(taskId)
    const entry = perTab?.get(tabId)
    if (entry?.state !== "permission_needed" || entry.at >= at) continue
    // Downgrade to `idle`, never delete: an absent entry reads as "never
    // reported" and would blank a working row for the mark's 30min life.
    const nextTabs = new Map(perTab)
    nextTabs.set(tabId, { ...entry, state: "idle" })
    out ??= new Map(tabs)
    out.set(taskId, nextTabs)
  }
  return out ?? tabs
}

/** Superseded answer marks; the host drops them so the overlay self-cleans. */
export function supersededAnswers(
  tabs: ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>>,
  marks: ReadonlyMap<string, number>,
  now: number = Date.now(),
): readonly string[] {
  const done: string[] = []
  for (const [key, at] of marks) {
    if (now - at > ANSWERED_TTL_MS) {
      done.push(key)
      continue
    }
    const sep = key.lastIndexOf("::")
    if (sep === -1) continue
    const entry = tabs.get(key.slice(0, sep))?.get(key.slice(sep + 2))
    if (entry === undefined || entry.at >= at) done.push(key)
  }
  return done
}

/** Drop answer marks by key. */
export function clearAnsweredTabs(keys: readonly string[]): void {
  if (keys.length === 0) return
  const next = new Map(answered.get())
  for (const k of keys) next.delete(k)
  answered.set(next)
}

/** Test/HMR hook: drop every mark. */
export function resetOptimisticActivity(): void {
  if (pruneTimer) clearTimeout(pruneTimer)
  pruneTimer = null
  cell.set(new Map())
  answered.set(new Map())
}

/**
 * Overlay the marks onto the authoritative activity map (pure — the
 * sidebar feed goes through this).
 *
 * - An authoritative event stamped at/after the mark ALWAYS wins (and the
 *   caller may then drop that mark via {@link clearOptimisticMark}).
 * - `running`: an unexpired mark spins a task the daemon hasn't caught up on.
 * - `interrupted`: suppresses any activity older than the interrupt, for as
 *   long as the mark lives — stale state cannot come back.
 */
export function mergeOptimisticActivity(
  auth: ReadonlyMap<string, TaskEngineState>,
  marks: ReadonlyMap<string, OptimisticMark>,
  now: number = Date.now(),
): ReadonlyMap<string, TaskEngineState> {
  if (marks.size === 0) return auth
  let out: Map<string, TaskEngineState> | null = null
  for (const [taskId, mark] of marks) {
    if (now - mark.at > ttlFor(mark)) continue
    const authoritative = auth.get(taskId)
    // Newer (or same-instant) authority always wins over a local guess.
    if (authoritative && authoritative.at >= mark.at) continue
    if (mark.kind === "running") {
      if (authoritative?.state === "running") continue
      out ??= new Map(auth)
      out.set(taskId, { state: "running", at: mark.at })
    } else if (authoritative !== undefined) {
      // Everything the daemon knew about this task predates the interrupt.
      out ??= new Map(auth)
      out.delete(taskId)
    }
  }
  return out ?? auth
}

/** Marks superseded (event at/after the mark); the host drops them so the overlay self-cleans. */
export function supersededMarks(
  auth: ReadonlyMap<string, TaskEngineState>,
  marks: ReadonlyMap<string, OptimisticMark>,
): readonly string[] {
  if (marks.size === 0) return []
  const done: string[] = []
  for (const [taskId, mark] of marks) {
    const authoritative = auth.get(taskId)
    if (authoritative && authoritative.at >= mark.at) done.push(taskId)
  }
  return done
}
