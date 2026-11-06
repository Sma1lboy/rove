/** The `pr.checks` reply and the words the Files pane's checks section builds from it. */

import type { TaskRow } from "rove-bridge/protocol"
import { compactAge } from "./inbox.ts"

export type CheckState = "fail" | "pending" | "pass" | "skipped"

export interface CheckRow {
  readonly name: string
  readonly state: CheckState
  readonly durationMs: number | null
  /** Epoch ms; absent from an older bridge, null when the check never reported it. */
  readonly startedAt?: number | null
  readonly completedAt?: number | null
  readonly url: string
  /** The Actions run whose log can be read; null for a check from another provider. */
  readonly runId: string | null
}

export type ChecksReply =
  | { readonly outcome: "none" }
  | { readonly outcome: "unavailable"; readonly detail: string }
  | {
      readonly outcome: "ok"
      readonly total: number
      readonly checks: readonly CheckRow[]
      readonly mergeable: string
      readonly mergeState: string
      readonly review: string
      readonly draft: boolean
    }

export type LogReply =
  | { readonly outcome: "ok"; readonly tail: string }
  | { readonly outcome: "none" }
  | { readonly outcome: "unavailable"; readonly detail: string }

/** Only an open PR on this Mac's own worktree has checks worth reading now. */
export function hasChecks(task: TaskRow): boolean {
  const pr = task.pr
  return (
    !!pr && pr.number !== undefined && !task.machine && (pr.lifecycle === "open" || pr.lifecycle === "ready_to_merge")
  )
}

export function checkCounts(checks: readonly CheckRow[]): Record<CheckState, number> {
  const counts = { fail: 0, pending: 0, pass: 0, skipped: 0 }
  for (const check of checks) counts[check.state]++
  return counts
}

/** `42s`, `3m12s`, `1h05m`: a CI duration, compact. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`
}

/** A check's timing line: how long a finished one took and how long ago it finished, or how long a running one has run. */
export function checkTiming(
  check: CheckRow,
  now: number,
): { readonly key: string; readonly vars: Record<string, string> } | null {
  const { startedAt, completedAt, durationMs } = check
  if (check.state === "pending") {
    return startedAt ? { key: "files.checks.runningFor", vars: { elapsed: duration(now - startedAt) } } : null
  }
  if (durationMs === null) return null
  if (!completedAt) return { key: "files.checks.took", vars: { duration: duration(durationMs) } }
  return { key: "files.checks.tookAgo", vars: { duration: duration(durationMs), age: compactAge(now - completedAt) } }
}

export type MergeTone = "success" | "warning" | "attention"
export interface MergePart {
  /** i18n key under `files.merge.*`. */
  readonly key: string
  readonly tone: MergeTone
}

/**
 * What stands between this PR and a merge, most blocking first, as keys the page words. A conflict hides the
 * check-derived blockers (they rerun after the merge); the review decision is always its own part.
 */
export function mergeParts(view: {
  mergeable: string
  mergeState: string
  review: string
  draft: boolean
}): MergePart[] {
  const parts: MergePart[] = []
  const state = view.mergeState.toUpperCase()
  if (view.draft) parts.push({ key: "files.merge.draft", tone: "warning" })
  if (view.mergeable.toUpperCase() === "CONFLICTING" || state === "DIRTY") {
    parts.push({ key: "files.merge.conflicts", tone: "attention" })
  } else if (state === "BEHIND") parts.push({ key: "files.merge.behind", tone: "warning" })
  else if (state === "UNSTABLE") parts.push({ key: "files.merge.unstable", tone: "warning" })
  else if (state === "BLOCKED") parts.push({ key: "files.merge.blocked", tone: "warning" })
  else if (state === "CLEAN" && !view.draft) parts.push({ key: "files.merge.clean", tone: "success" })
  const review = view.review.toUpperCase()
  if (review === "APPROVED") parts.push({ key: "files.merge.approved", tone: "success" })
  else if (review === "CHANGES_REQUESTED") parts.push({ key: "files.merge.changes", tone: "attention" })
  else if (review === "REVIEW_REQUIRED") parts.push({ key: "files.merge.reviewRequired", tone: "warning" })
  return parts
}
