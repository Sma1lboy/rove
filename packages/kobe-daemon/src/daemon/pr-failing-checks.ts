/**
 * On-demand read of a PR's FAILING check logs ("fix my CI").
 *
 * The `pr-status-collector` poller only ever learns that checks are red — it
 * reduces `statusCheckRollup` to one glyph and throws the rest away. Learning
 * WHY meant leaving Rove for a browser. This module is the other half: given a
 * task, fetch the failing jobs' log tails so the TUI can paste them into the
 * task's own engine.
 *
 * ON DEMAND ONLY. Nothing here runs on the poll interval — a `gh run view
 * --log-failed` downloads a whole job log, which is orders of magnitude more
 * expensive than the rollup the poller fetches every tick. The caller is a
 * menu entry a human clicked, so the cost is paid once per click and the
 * collector's backoff ladder is untouched.
 *
 * Two `gh` calls, both in the task's worktree:
 *   1. `gh pr view <n> --json statusCheckRollup` — the CURRENT rollup, so the
 *      job names and conclusions agree with the chip the user just looked at.
 *   2. `gh run view <runId> --log-failed` — one call per distinct workflow run
 *      behind those failures (normally exactly one), returning every failed
 *      job's log at once as `job<TAB>step<TAB>text` lines.
 *
 * The workflow run id comes from each check's `detailsUrl`
 * (`…/actions/runs/<runId>/job/<jobId>`), which `gh` already returns with the
 * rollup — the PR's own `databaseId` is a different number entirely and
 * `gh run view` does not accept it.
 *
 * Everything the caller consumes is capped: {@link MAX_FAILING_JOBS} jobs,
 * {@link MAX_TAIL_LINES} lines each. A failing CI job can log tens of
 * thousands of lines, and the payload's destination is an engine's context
 * window.
 *
 * The parsing halves are pure and unit-tested; only {@link readFailingChecks}
 * touches a subprocess.
 */

import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import { PR_VIEW_TIMEOUT_MS, spawnGh } from "./pr-status-collector.ts"

/** At most this many failing jobs are reported — the rest are counted, not read. */
export const MAX_FAILING_JOBS = 3
/** Last N log lines kept per job. */
export const MAX_TAIL_LINES = 200
/** A whole job log download is slower than the rollup fetch; give it longer. */
export const RUN_LOG_TIMEOUT_MS = 30_000

/** One failing check, with the tail of its job log. */
export interface PrFailingCheck {
  readonly jobName: string
  /** `gh`'s own conclusion word (FAILURE / TIMED_OUT / CANCELLED / …). */
  readonly conclusion: string
  /** The check's `detailsUrl` — where a human would open it. */
  readonly url: string
  /** Last {@link MAX_TAIL_LINES} log lines, or "" when the log is unavailable. */
  readonly tail: string
}

/** Why no answer could be obtained, as opposed to "the answer was none". */
export interface PrChecksUnavailable {
  /** `gh_failed` — the CLI ran and refused (not installed, not authenticated,
   *  no network, no such PR); `gh_error` — the read threw before/while parsing. */
  readonly reason: "gh_failed" | "gh_error"
  /** `gh`'s own stderr (or the thrown message), trimmed. The only thing in
   *  here that tells a user WHICH of those it was. */
  readonly detail: string
}

export interface PrFailingChecksResult {
  readonly checks: readonly PrFailingCheck[]
  /** How many failing checks existed before the {@link MAX_FAILING_JOBS} cap. */
  readonly totalFailing: number
  /**
   * Set when the rollup could not be read at all.
   *
   * `checks: []` alone had to mean three different things — `gh` missing, `gh`
   * unauthenticated, and the checks genuinely turning green — and the UI could
   * only render the third. A user staring at a red PR badge was told the
   * checks were probably no longer red; the actual answer was an expired
   * `gh auth login`.
   */
  readonly unavailable?: PrChecksUnavailable
}

/** A failing rollup entry reduced to what the log fetch needs. */
export interface FailingCheckTarget {
  readonly jobName: string
  readonly conclusion: string
  readonly url: string
  /** Workflow run id parsed out of `detailsUrl`, or null for a non-Actions check. */
  readonly runId: string | null
}

function stringField(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null) return ""
  const field = (value as Record<string, unknown>)[key]
  return typeof field === "string" ? field : ""
}

/** `…/actions/runs/33738142593/job/100593506044` → `33738142593`. */
export function runIdFromDetailsUrl(url: string): string | null {
  return /\/actions\/runs\/(\d+)\b/.exec(url)?.[1] ?? null
}

/**
 * The FAILING entries of a `statusCheckRollup`, in `gh`'s own order.
 *
 * Deliberately narrower than `checkStateFromRollup`'s notion of failing: a
 * still-running check (`status` present and not COMPLETED) is skipped even
 * when it carries a stale conclusion, and a legacy `StatusContext` is read
 * from its `state`. Pure — unit-tested.
 */
export function failingCheckTargets(rollup: readonly unknown[]): FailingCheckTarget[] {
  const targets: FailingCheckTarget[] = []
  for (const entry of rollup) {
    const status = stringField(entry, "status").toUpperCase()
    const conclusion = stringField(entry, "conclusion").toUpperCase()
    const contextState = stringField(entry, "state").toUpperCase()
    let failedAs: string | null = null
    if (status && status !== "COMPLETED") failedAs = null
    else if (conclusion) {
      failedAs = conclusion === "SUCCESS" || conclusion === "NEUTRAL" || conclusion === "SKIPPED" ? null : conclusion
    } else if (contextState === "FAILURE" || contextState === "ERROR") failedAs = contextState
    if (failedAs === null) continue
    const url = stringField(entry, "detailsUrl") || stringField(entry, "targetUrl")
    targets.push({
      jobName: stringField(entry, "name") || stringField(entry, "context") || "check",
      conclusion: failedAs,
      url,
      runId: runIdFromDetailsUrl(url),
    })
  }
  return targets
}

/**
 * Group `gh run view --log-failed` output by job.
 *
 * Its lines are `job<TAB>step<TAB>timestamp text`. The step column is dropped
 * (the job name is what a prompt can name) and the timestamp prefix is kept —
 * it is how a reader tells a slow step from a crashed one. Only the LAST
 * `maxLines` per job survive: a failure's cause is at the end of the log.
 * Lines with no tab at all (gh preamble) are ignored. Pure — unit-tested.
 */
export function parseFailedRunLog(text: string, maxLines: number = MAX_TAIL_LINES): Map<string, string[]> {
  const byJob = new Map<string, string[]>()
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "")
    if (line.length === 0) continue
    const firstTab = line.indexOf("\t")
    if (firstTab <= 0) continue
    const job = line.slice(0, firstTab)
    const secondTab = line.indexOf("\t", firstTab + 1)
    const body = (secondTab === -1 ? line.slice(firstTab + 1) : line.slice(secondTab + 1)).replace(/^﻿/, "")
    let lines = byJob.get(job)
    if (!lines) {
      lines = []
      byJob.set(job, lines)
    }
    lines.push(body)
    if (lines.length > maxLines) lines.shift()
  }
  return byJob
}

/**
 * Join the targets to their log tails, capped at {@link MAX_FAILING_JOBS}.
 * A target whose job produced no lines still reports (with an empty `tail`) —
 * "job X failed and its log could not be read" is a usable fact, and dropping
 * it would make an unreadable log look like a passing check. Pure.
 */
export function joinFailingChecks(
  targets: readonly FailingCheckTarget[],
  logsByJob: ReadonlyMap<string, string[]>,
): PrFailingChecksResult {
  const checks = targets.slice(0, MAX_FAILING_JOBS).map((target) => ({
    jobName: target.jobName,
    conclusion: target.conclusion,
    url: target.url,
    tail: (logsByJob.get(target.jobName) ?? []).join("\n"),
  }))
  return { checks, totalFailing: targets.length }
}

/**
 * Run one `gh` command under a timeout.
 *
 * Returns the failure instead of flattening it to `""`. `spawnGh` already
 * captures `stderr` and `spawnError` precisely so a caller can tell an absent
 * `gh` from an unauthenticated one from a real empty answer — this function
 * used to throw all three away one line after receiving them.
 */
async function ghText(
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ ok: true; stdout: string } | { ok: false; detail: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await spawnGh(args, cwd, controller.signal)
    if (res.status === 0) return { ok: true, stdout: res.stdout }
    const stderr = res.stderr.trim()
    if (res.spawnError) return { ok: false, detail: stderr || "gh could not be started — is the GitHub CLI installed?" }
    if (controller.signal.aborted) return { ok: false, detail: `gh timed out after ${timeoutMs}ms` }
    return { ok: false, detail: stderr || `gh exited ${res.status}` }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch the failing checks + log tails for a PR. Never throws: an absent `gh`,
 * an unauthenticated one, or a deleted run all degrade to fewer facts, and the
 * caller renders what it got. An empty `checks` means "nothing to report",
 * which the TUI turns into a toast rather than an engine prompt.
 */
export async function readFailingChecks(opts: {
  readonly worktreePath: string
  readonly prNumber: number
}): Promise<PrFailingChecksResult> {
  try {
    const rollupRead = await ghText(
      ["pr", "view", String(opts.prNumber), "--json", "statusCheckRollup"],
      opts.worktreePath,
      PR_VIEW_TIMEOUT_MS,
    )
    if (!rollupRead.ok) {
      // The toast can only carry one truncated line, so the whole of `gh`'s
      // stderr goes here — this is the only place the hint after the first
      // line ("please run: gh auth login") survives.
      logDaemonInfo("pr-failing-checks", `gh could not read PR #${opts.prNumber}: ${rollupRead.detail}`)
      return { checks: [], totalFailing: 0, unavailable: { reason: "gh_failed", detail: rollupRead.detail } }
    }
    const parsed = JSON.parse(rollupRead.stdout) as { statusCheckRollup?: unknown }
    const rollup = Array.isArray(parsed.statusCheckRollup) ? parsed.statusCheckRollup : []
    const targets = failingCheckTargets(rollup)
    if (targets.length === 0) return { checks: [], totalFailing: 0 }
    // One log download per distinct run — a PR's failures almost always sit in
    // one workflow run, and the cap keeps a fan-out matrix from becoming N
    // downloads.
    const runIds: string[] = []
    for (const target of targets.slice(0, MAX_FAILING_JOBS)) {
      if (target.runId && !runIds.includes(target.runId)) runIds.push(target.runId)
    }
    const logsByJob = new Map<string, string[]>()
    for (const runId of runIds) {
      // A log download that fails still degrades quietly: the check list is
      // already known, and `joinFailingChecks` reports a job with an empty
      // tail rather than dropping it. That is a partial answer, not none.
      const log = await ghText(["run", "view", runId, "--log-failed"], opts.worktreePath, RUN_LOG_TIMEOUT_MS)
      if (!log.ok) continue
      for (const [job, lines] of parseFailedRunLog(log.stdout)) if (!logsByJob.has(job)) logsByJob.set(job, lines)
    }
    return joinFailingChecks(targets, logsByJob)
  } catch (err) {
    logDaemonError("pr-failing-checks", err)
    return {
      checks: [],
      totalFailing: 0,
      unavailable: { reason: "gh_error", detail: err instanceof Error ? err.message : String(err) },
    }
  }
}
