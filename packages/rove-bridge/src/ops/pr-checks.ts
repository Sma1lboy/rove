/**
 * Read-only merge-readiness ops for the Files pane: one PR's checks (state, duration) with its merge /
 * review state, and the tail of one failed job's log. Both go through the machine's own `gh` in the
 * task's worktree, and both are on demand: the log download is the costly one, so only the tails stay cached.
 */

import { ghText, parseFailedRunLog, runIdFromDetailsUrl } from "@sma1lboy/rove-daemon/daemon/pr-failing-checks"
import { BridgeError } from "../protocol.ts"
import { flag, optText, taskId } from "./args.ts"
import type { Args, OpContext, OpTable } from "./types.ts"

export type CheckState = "fail" | "pending" | "pass" | "skipped"

export interface CheckRow {
  readonly name: string
  readonly state: CheckState
  /** Run time in ms; null while running or when the check reports no times. */
  readonly durationMs: number | null
  /** Epoch ms the check started / finished; null when not yet (or never) reported. */
  readonly startedAt: number | null
  readonly completedAt: number | null
  readonly url: string
  /** The Actions run a log can be read from; null for a check from another provider. */
  readonly runId: string | null
}

const VIEW_TIMEOUT_MS = 10_000
const LOG_TIMEOUT_MS = 30_000
const MAX_CHECKS = 60
const CHECKS_TTL_MS = 30_000
const LOG_TTL_MS = 60_000
const MAX_CACHED = 24
export const LOG_LINES = 40
export const LOG_CHARS = 4000
const RUN_ID = /^\d{1,15}$/
const RANK: Record<CheckState, number> = { fail: 0, pending: 1, pass: 2, skipped: 3 }

export interface PrChecksDeps {
  gh: typeof ghText
  now(): number
}

const realDeps: PrChecksDeps = { gh: ghText, now: Date.now }

function field(entry: unknown, key: string): string {
  const v = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>)[key] : undefined
  return typeof v === "string" ? v : ""
}

/** The rollup's own vocabulary (a check run, or a legacy commit status) as one of four states. */
export function checkState(entry: unknown): CheckState {
  const status = field(entry, "status").toUpperCase()
  const conclusion = field(entry, "conclusion").toUpperCase()
  const context = field(entry, "state").toUpperCase()
  if (status && status !== "COMPLETED") return "pending"
  if (conclusion)
    return conclusion === "SUCCESS" ? "pass" : conclusion === "NEUTRAL" || conclusion === "SKIPPED" ? "skipped" : "fail"
  if (context === "SUCCESS") return "pass"
  if (context === "FAILURE" || context === "ERROR") return "fail"
  return "pending"
}

/** A rollup timestamp as epoch ms; GitHub sends the zero date for a time it has not set. */
function timeOf(entry: unknown, key: string): number | null {
  const at = Date.parse(field(entry, key))
  return Number.isFinite(at) && at > 0 ? at : null
}

export function checkRows(rollup: readonly unknown[]): CheckRow[] {
  const rows = rollup.map((entry, i): CheckRow & { i: number } => {
    const url = field(entry, "detailsUrl") || field(entry, "targetUrl")
    const startedAt = timeOf(entry, "startedAt")
    const completedAt = timeOf(entry, "completedAt")
    return {
      i,
      name: field(entry, "name") || field(entry, "context") || "check",
      state: checkState(entry),
      durationMs:
        startedAt !== null && completedAt !== null && completedAt >= startedAt ? completedAt - startedAt : null,
      startedAt,
      completedAt,
      url,
      runId: runIdFromDetailsUrl(url),
    }
  })
  return rows.sort((a, b) => RANK[a.state] - RANK[b.state] || a.i - b.i).map(({ i: _, ...row }) => row)
}

/** Insertion-ordered cache with a TTL and a size cap. */
function cache<T>(ttl: number) {
  const map = new Map<string, { at: number; value: T }>()
  return {
    get(key: string, now: number): T | undefined {
      const hit = map.get(key)
      return hit && now - hit.at < ttl ? hit.value : undefined
    },
    set(key: string, value: T, now: number): void {
      map.delete(key)
      map.set(key, { at: now, value })
      for (const old of map.keys()) {
        if (map.size <= MAX_CACHED) break
        map.delete(old)
      }
    },
  }
}

async function worktreeOf(ctx: OpContext, id: string): Promise<{ worktree: string; pr: number | undefined }> {
  const res = await ctx.api.verb<{ task: { worktreePath?: string; prStatus?: { number?: number } } }>("get-task", [
    flag("task-id", id),
  ])
  const { worktreePath, prStatus } = res.task
  if (!worktreePath) throw new BridgeError("NO_WORKTREE", `task ${id} has no worktree yet`)
  return { worktree: worktreePath, pr: prStatus?.number }
}

export function prChecksOps(deps: PrChecksDeps = realDeps): OpTable {
  const checks = cache<unknown>(CHECKS_TTL_MS)
  const logs = cache<ReadonlyMap<string, string[]>>(LOG_TTL_MS)
  return {
    "pr.checks": {
      kind: "read",
      destructive: false,
      wraps: "gh pr view <n> --json statusCheckRollup,mergeable,mergeStateStatus,reviewDecision,isDraft (cached 30s)",
      async run(a: Args, ctx: OpContext) {
        const id = taskId(a)
        const { worktree, pr } = await worktreeOf(ctx, id)
        if (pr === undefined) return { outcome: "none" }
        const key = `${id}:${pr}`
        const cached = a.fresh === true ? undefined : checks.get(key, deps.now())
        if (cached) return cached
        const read = await deps.gh(
          ["pr", "view", String(pr), "--json", "statusCheckRollup,mergeable,mergeStateStatus,reviewDecision,isDraft"],
          worktree,
          VIEW_TIMEOUT_MS,
        )
        if (!read.ok) return { outcome: "unavailable", detail: read.detail }
        let view: Record<string, unknown>
        try {
          view = JSON.parse(read.stdout) as Record<string, unknown>
        } catch {
          return { outcome: "unavailable", detail: "gh returned unreadable JSON" }
        }
        const rows = checkRows(Array.isArray(view.statusCheckRollup) ? view.statusCheckRollup : [])
        const result = {
          outcome: "ok",
          total: rows.length,
          checks: rows.slice(0, MAX_CHECKS),
          mergeable: typeof view.mergeable === "string" ? view.mergeable : "",
          mergeState: typeof view.mergeStateStatus === "string" ? view.mergeStateStatus : "",
          review: typeof view.reviewDecision === "string" ? view.reviewDecision : "",
          draft: view.isDraft === true,
        }
        checks.set(key, result, deps.now())
        return result
      },
    },

    "pr.checkLog": {
      kind: "read",
      destructive: false,
      wraps: "gh run view <runId> --log-failed (last 40 lines of one job; cached 60s)",
      async run(a: Args, ctx: OpContext) {
        const id = taskId(a)
        const run = optText(a, "runId", 20) ?? ""
        if (!RUN_ID.test(run)) throw new BridgeError("BAD_ARGS", "runId must be a run number")
        const job = optText(a, "job", 200) ?? ""
        if (!job) throw new BridgeError("BAD_ARGS", "job is required")
        const { worktree } = await worktreeOf(ctx, id)
        let byJob = logs.get(`${worktree}:${run}`, deps.now())
        if (!byJob) {
          const read = await deps.gh(["run", "view", run, "--log-failed"], worktree, LOG_TIMEOUT_MS)
          if (!read.ok) return { outcome: "unavailable", detail: read.detail }
          byJob = parseFailedRunLog(read.stdout, LOG_LINES)
          logs.set(`${worktree}:${run}`, byJob, deps.now())
        }
        const tail = (byJob.get(job) ?? []).join("\n")
        return tail ? { outcome: "ok", tail: tail.slice(-LOG_CHARS) } : { outcome: "none" }
      },
    },
  }
}

export const PR_CHECKS_OPS: OpTable = prChecksOps()
