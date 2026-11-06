/**
 * "While you were away": when the page comes back after a long gap (a wake, a phone resume, a reconnect) it counts what
 * changed meanwhile from the task feed it already holds, so no daemon field is needed. This browser remembers when it
 * last looked and which PRs were already merged then; the rest is read off the rows: an episode that began after that
 * moment (finished, failed), what waits on the user now, and PRs merged that were not before.
 */

import type { TaskRow, TasksPayload } from "rove-bridge/protocol"
import { createStore } from "./store.ts"

export const AWAY_MS = 10 * 60_000
const KEY = "rove.awaySeen"
const HEARTBEAT_MS = 60_000

export interface Seen {
  /** When this browser last looked at the page (ms epoch). */
  readonly at: number
  /** Tasks whose PR was merged by then. */
  readonly merged: readonly string[]
}

export interface Recap {
  readonly since: number
  readonly finished: readonly TaskRow[]
  readonly needs: readonly TaskRow[]
  readonly failed: readonly TaskRow[]
  readonly merged: readonly TaskRow[]
}

const live = (tasks: readonly TaskRow[]): TaskRow[] => tasks.filter((task) => !task.deleting)
const isMerged = (task: TaskRow): boolean => task.pr?.lifecycle === "merged"
const FAILED: Record<string, true> = { error: true, dead: true }

/** Pure: what changed since `seen`, or null when nothing did (or there was no earlier look to compare to). */
export function recapOf(tasks: readonly TaskRow[], seen: Seen | null, now: number): Recap | null {
  if (!seen || now - seen.at <= AWAY_MS) return null
  const rows = live(tasks)
  const began = (task: TaskRow): boolean => (task.activity?.since ?? 0) > seen.at
  const failed = rows.filter((task) => FAILED[task.activity?.state ?? ""] === true && began(task))
  const needs = rows.filter((task) => task.group === "waiting-on-you" && !failed.includes(task))
  const finished = rows.filter((task) => task.activity?.state === "turn_complete" && began(task))
  const merged = rows.filter((task) => isMerged(task) && !seen.merged.includes(task.id))
  if (finished.length + needs.length + failed.length + merged.length === 0) return null
  return { since: seen.at, finished, needs, failed, merged }
}

export const recap = createStore<Recap | null>(null)

function read(): Seen | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Seen> | null
    return raw && typeof raw.at === "number" && Array.isArray(raw.merged) ? (raw as Seen) : null
  } catch {
    return null
  }
}

function write(tasks: readonly TaskRow[], now: number): void {
  const seen: Seen = {
    at: now,
    merged: live(tasks)
      .filter(isMerged)
      .map((task) => task.id),
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(seen))
  } catch {
    /* storage full or blocked: the recap just does not appear next time */
  }
}

/** The feed arrives in pieces (rows, then activity, then PR state): the recap is recomputed over this long after a return. */
const SETTLE_MS = 8000

/**
 * Wire the page to the recap. `payload()` is the current task feed (null before the first one), `subscribe` fires on
 * each new one. Returns the cleanup. A look is only recorded while the page is visible, so a hidden tab ages. On a
 * return after a gap, the earlier look is kept as the baseline while the feed settles, then replaced by this one.
 */
export function watchAway(payload: () => TasksPayload | null, subscribe: (fn: () => void) => () => void): () => void {
  let baseline: Seen | null = null
  let settleAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const record = (): void => {
    const feed = payload()
    if (feed && !document.hidden) write(feed.tasks, Date.now())
  }
  const settle = (): void => {
    baseline = null
    record()
  }
  const look = (): void => {
    const feed = payload()
    if (!feed || document.hidden) return
    const now = Date.now()
    if (!baseline) {
      const earlier = read()
      if (earlier && now - earlier.at > AWAY_MS) {
        baseline = earlier
        settleAt = now + SETTLE_MS
        timer = setTimeout(settle, SETTLE_MS)
      }
    }
    if (!baseline) {
      record()
      return
    }
    const found = recapOf(feed.tasks, baseline, settleAt - SETTLE_MS)
    if (found) recap.set(found)
  }
  look()
  const off = subscribe(look)
  document.addEventListener("visibilitychange", look)
  // A page left open and visible keeps its look fresh; timers stop while the machine sleeps, so a wake reads as a gap.
  const beat = setInterval(() => {
    if (!baseline) record()
  }, HEARTBEAT_MS)
  return () => {
    off()
    document.removeEventListener("visibilitychange", look)
    clearInterval(beat)
    clearTimeout(timer)
  }
}
