/**
 * Daemon-side PR-status poller: per eligible task, `gh pr list --head <branch>
 * --state all --json …` → neutral {@link TaskPRStatus} → `orch.setPRStatus`.
 * Persisting on the Task lets the `task.snapshot` broadcast carry the chip to
 * every pane and the web board, and survives a daemon restart. The poller only
 * persists; the TUI fires the checks-resolved toast/bell.
 *
 * `pr list --head`, not `pr view`, so "no PR" is a success (exit 0, empty
 * array), never a guessed stderr pattern. Multiple PRs per branch: see
 * {@link pickPr}.
 *
 * The failure classifier and `--json` field set live in kobe's
 * `monitor/pr-status.ts` and arrive via `runtime.prStatus.classify` /
 * `viewFields`: kobe-daemon must not depend on the `kobe` package.
 *
 * GitHub only: `ssh://` projects and non-GitHub remotes yield no PR.
 *
 * Per-task schedule by outcome:
 *   - open PR → tick cadence (checks move).
 *   - merged / closed → {@link SETTLED_BACKOFF_MS}.
 *   - no PR → {@link NO_PR_BACKOFF_MS}.
 *   - `gh`/transport error (missing, unauthed, timeout, network, bad JSON, or
 *     ANY unrecognized non-zero exit) → exponential backoff capped at
 *     {@link PR_FAILURE_CAP_MS}; the kind is logged.
 *   - no GitHub remote → {@link NO_REMOTE_BACKOFF_MS}.
 * Every delay is jittered ({@link PR_POLL_JITTER_RATIO}) so tasks re-armed
 * together (a reconnect) don't poll in lockstep.
 *
 * A status is WRITTEN only from exit 0 + non-empty array; error or empty keeps
 * the last value, so a transient blip never clobbers a known chip. A non-zero
 * exit is ALWAYS `error`, never "no PR". At most {@link PR_POLL_CONCURRENCY}
 * `gh` calls in flight; a per-task failure is logged, never fatal, never blocks
 * other tasks.
 */

import { spawn } from "node:child_process"
import type { DaemonOrchestrator, DaemonTask as Task } from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import { decodeCapturedChunks } from "./poll-scheduling.ts"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { startTicker } from "./ticker.ts"

export interface GhPrView {
  readonly number?: number
  readonly state?: string
  readonly statusCheckRollup?: readonly unknown[]
  readonly [key: string]: unknown
}

/** Rank for {@link pickPr} — open beats merged/closed. */
const PR_STATE_RANK: Record<string, number> = { OPEN: 2, MERGED: 1, CLOSED: 1 }

/**
 * Open beats merged/closed; ties (incl. merged vs closed) keep the first entry,
 * which `gh pr list` returns most-recently-updated-first. Empty → undefined.
 */
export function pickPr(views: readonly GhPrView[]): GhPrView | undefined {
  let best: GhPrView | undefined
  let bestRank = -1
  for (const view of views) {
    const rank = PR_STATE_RANK[(view.state ?? "").toUpperCase()] ?? 0
    if (rank > bestRank) {
      best = view
      bestRank = rank
    }
  }
  return best
}

export type PrViewErrorKind = "missing-binary" | "auth" | "timeout" | "network" | "parse" | "no-remote" | "unknown"

/** `gh` hits the network; 30s tracks checks without hammering it. */
export const DEFAULT_PR_STATUS_POLL_MS = 30_000
export const NO_PR_BACKOFF_MS = 5 * 60_000
export const SETTLED_BACKOFF_MS = 10 * 60_000
/** First failure backoff; doubles per consecutive failure. */
export const PR_FAILURE_BASE_MS = DEFAULT_PR_STATUS_POLL_MS
export const PR_FAILURE_CAP_MS = 15 * 60_000
export const NO_REMOTE_BACKOFF_MS = 30 * 60_000
/** ± jitter ratio on every scheduled delay (de-syncs N tasks after a reconnect). */
export const PR_POLL_JITTER_RATIO = 0.2
/** Kill a `gh pr list` that hangs past this (network stall). */
export const PR_VIEW_TIMEOUT_MS = 10_000

/**
 * `gh pr list` calls in flight per pass. `startTicker` drops ticks while a pass
 * runs, so a serial pass makes the refresh `max(tickMs, N × gh_latency)`:
 * measured at 800ms/call, 42s at 50 tasks, 170s at 200. 8 keeps 200 tasks in
 * one tick, far below fd/process ceilings; `gh` is network-bound, and the
 * `nextPoll` backoffs are what bound how often it runs.
 */
export const PR_POLL_CONCURRENCY = 8

/**
 * One `gh pr list --head <branch>`:
 *   - `pr`    — {@link pickPr} chose a payload (the only case that WRITES a status).
 *   - `empty` — exit 0, the branch has no PR.
 *   - `error` — any `gh`/transport failure or non-zero exit; keeps the last
 *               status and logs why, rather than reading as "no PR".
 */
export type PrViewResult =
  | { kind: "pr"; view: GhPrView }
  | { kind: "empty" }
  | { kind: "error"; error: PrViewErrorKind }

/** Runs `gh pr list --head` for a branch in a worktree. Injectable for tests. */
export type PrViewRunner = (worktreePath: string, branch: string) => Promise<PrViewResult>

export interface GhSpawnResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  /** The child failed to spawn (ENOENT etc.) and it was NOT our abort. */
  readonly spawnError: boolean
}

/** Captures stderr too (the classifier needs it). Never rejects: spawn error or
 * abort resolves with `status: null`. */
export function spawnGh(args: readonly string[], cwd: string, signal: AbortSignal): Promise<GhSpawnResult> {
  return new Promise((resolve) => {
    const outChunks: (Buffer | string)[] = []
    const errChunks: (Buffer | string)[] = []
    let settled = false
    const finish = (status: number | null, spawnError: boolean): void => {
      if (settled) return
      settled = true
      resolve({ status, stdout: decodeCapturedChunks(outChunks), stderr: decodeCapturedChunks(errChunks), spawnError })
    }
    const child = spawn("gh", args.slice(), {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
      killSignal: "SIGKILL",
    })
    child.stdout?.on("data", (chunk: Buffer | string) => {
      outChunks.push(chunk)
    })
    child.stderr?.on("data", (chunk: Buffer | string) => {
      errChunks.push(chunk)
    })
    // An abort (our timeout) also surfaces as an `error` event — don't count
    // that as a spawn failure; the caller reads `timedOut` separately.
    child.on("error", () => finish(null, !signal.aborted))
    child.on("close", (code) => finish(code, false))
  })
}

/** Structurally kobe's `classifyGhFailure`; injected, not imported (see header). */
type GhFailureClassifier = DaemonRuntimeAdapter["prStatus"]["classify"]

/**
 * Exit 0 + parseable JSON → {@link pickPr} (empty array → `empty`); non-zero
 * exit or bad JSON → `classify`, never `empty`. Never throws.
 */
export function makeGhPrViewRunner(classify: GhFailureClassifier, viewFields: string): PrViewRunner {
  return async (worktreePath, branch) => {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, PR_VIEW_TIMEOUT_MS)
    try {
      const res = await spawnGh(
        ["pr", "list", "--head", branch, "--state", "all", "--json", viewFields],
        worktreePath,
        controller.signal,
      )
      if (res.status === 0 && !timedOut) {
        try {
          const views = JSON.parse(res.stdout) as GhPrView[]
          const picked = Array.isArray(views) ? pickPr(views) : undefined
          return picked ? { kind: "pr", view: picked } : { kind: "empty" }
        } catch {
          return classify({ parseError: true }) as PrViewResult
        }
      }
      return classify({
        spawnError: res.spawnError,
        timedOut,
        exitCode: res.status,
        stderr: res.stderr,
      }) as PrViewResult
    } finally {
      clearTimeout(timer)
    }
  }
}

/** A real branch on a LOCAL worktree; `main` rows and remote projects are skipped. */
export function isPrPollable(task: Task): boolean {
  if (task.kind === "main") return false
  if (!task.branch || !task.worktreePath) return false
  if (task.repo.startsWith("ssh://") || task.worktreePath.startsWith("ssh://")) return false
  return true
}

/** `failures` is the consecutive-failure streak driving backoff; reset to 0 on
 * success / empty / no-remote. */
export interface PrPollEntry {
  readonly nextAllowedAt: number
  readonly failures: number
}

/** Keyed by task id; carried across passes by the live poller. */
export type PrPollSchedule = Map<string, PrPollEntry>

export interface PrStatusPassOptions {
  readonly runtime: Pick<DaemonRuntimeAdapter, "prStatus">
  readonly run: PrViewRunner
  /** Epoch ms. */
  readonly now: number
  /** ISO timestamp stamped onto each status. */
  readonly at: string
  readonly schedule: PrPollSchedule
  readonly tickMs?: number
  /** Jitter source; `() => 0.5` yields the exact base delay. */
  readonly rand?: () => number
}

/**
 * Set or clear `lastError` on the last good status, keeping its value. Returns
 * whether anything was persisted; no-op without a PR status (no chip drawn).
 * `samePrStatus` ignores `lastError`, so this change check is what stops a long
 * outage re-persisting and re-broadcasting every backoff tick.
 */
async function setPrStaleMarker(orch: DaemonOrchestrator, taskId: string, error: string | undefined): Promise<boolean> {
  const prev = orch.getTask(taskId)?.prStatus
  if (!prev || prev.lastError === error) return false
  const { lastError: _cleared, ...rest } = prev
  await orch.setPRStatus(taskId, error === undefined ? rest : { ...rest, lastError: error })
  return true
}

/** One pass over eligible, due tasks. Returns ids whose persisted status changed. */
export async function runPrStatusPass(orch: DaemonOrchestrator, opts: PrStatusPassOptions): Promise<string[]> {
  const tickMs = opts.tickMs ?? DEFAULT_PR_STATUS_POLL_MS
  const rand = opts.rand
  const cfg = {
    tickMs,
    settledMs: SETTLED_BACKOFF_MS,
    noPrMs: NO_PR_BACKOFF_MS,
    noRemoteMs: NO_REMOTE_BACKOFF_MS,
    failureBaseMs: PR_FAILURE_BASE_MS,
    failureCapMs: PR_FAILURE_CAP_MS,
    jitterRatio: PR_POLL_JITTER_RATIO,
  }
  const tasks = orch.listTasks()
  // Drop entries for deleted tasks; the ineligible-delete below never sees
  // them, so they'd grow unbounded.
  const live = new Set(tasks.map((task) => task.id))
  for (const id of opts.schedule.keys()) {
    if (!live.has(id)) opts.schedule.delete(id)
  }
  // Select due tasks against one `opts.now` before any `gh` runs, so the set
  // doesn't depend on how long the pass takes.
  const due: Array<{ task: Task; prevFailures: number }> = []
  for (const task of tasks) {
    if (!isPrPollable(task)) {
      opts.schedule.delete(task.id) // forget backoff for now-ineligible tasks
      continue
    }
    const entry = opts.schedule.get(task.id)
    if (entry && opts.now < entry.nextAllowedAt) continue
    due.push({ task, prevFailures: entry?.failures ?? 0 })
  }

  /** One task's poll. Returns its id when the persisted status changed. */
  const pollOne = async (task: Task, prevFailures: number): Promise<string | undefined> => {
    try {
      const result = await opts.run(task.worktreePath, task.branch)
      if (result.kind === "error") {
        // Not "no PR": keep the last value, log, mark stale, back off.
        logDaemonInfo(
          "pr-status-poller",
          `gh pr list failed (${result.error}) for task ${task.id} [${task.branch}] — keeping last PR status, backing off`,
        )
        const marked = await setPrStaleMarker(orch, task.id, result.error)
        opts.schedule.set(
          task.id,
          opts.runtime.prStatus.nextPoll({ kind: "error", error: result.error }, prevFailures, opts.now, cfg, rand),
        )
        return marked ? task.id : undefined
      }
      if (result.kind === "empty") {
        // Keep the last value. `gh` reaching the provider clears the stale
        // marker, whatever it answered.
        const marked = await setPrStaleMarker(orch, task.id, undefined)
        opts.schedule.set(task.id, opts.runtime.prStatus.nextPoll({ kind: "empty" }, prevFailures, opts.now, cfg, rand))
        return marked ? task.id : undefined
      }
      const next = opts.runtime.prStatus.mapView(result.view, opts.at)
      // Re-read: the task may have been deleted during the await.
      const current = orch.getTask(task.id)
      if (!current) {
        opts.schedule.delete(task.id)
        return undefined
      }
      // `sameStatus` ignores `lastError`; `next` never carries one, so writing
      // it is what clears the stale marker.
      const wasStale = current.prStatus?.lastError !== undefined
      let changedId: string | undefined
      if (wasStale || !opts.runtime.prStatus.sameStatus(current.prStatus, next ?? undefined)) {
        await orch.setPRStatus(task.id, next)
        changedId = task.id
      }
      const settled = next?.lifecycle === "merged" || next?.lifecycle === "closed"
      opts.schedule.set(
        task.id,
        opts.runtime.prStatus.nextPoll({ kind: "pr", settled }, prevFailures, opts.now, cfg, rand),
      )
      return changedId
    } catch (err) {
      // Only an injected runner throws; back off as a transient error.
      logDaemonError("pr-status-poller", err)
      const marked = await setPrStaleMarker(orch, task.id, "network").catch(() => false)
      opts.schedule.set(
        task.id,
        opts.runtime.prStatus.nextPoll({ kind: "error", error: "network" }, prevFailures, opts.now, cfg, rand),
      )
      return marked ? task.id : undefined
    }
  }

  // Per-task slots keep returned ids in task order however polls interleave.
  const slots = new Array<string | undefined>(due.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (let i = cursor++; i < due.length; i = cursor++) {
      const item = due[i]
      if (item) slots[i] = await pollOne(item.task, item.prevFailures)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PR_POLL_CONCURRENCY, due.length) }, worker))
  return slots.filter((id): id is string => id !== undefined)
}

/**
 * Start the live poller; `intervalMs <= 0` disables it (no-op stop).
 *
 * Gate: `hasSubscribers() || hasWorkingAgent()`. `prStatus` is Rove's only CI
 * truth, and an unattended agent has no GUI yet needs `checkState` fresh when
 * it asks whether its PR is green. `hasWorkingAgent` reads the in-memory
 * engine-activity registry (fed by the ungated `engine.reportEvent` path), so
 * it costs nothing; a parked daemon (no GUI, no live engine) still polls nobody.
 */
export function startPrStatusPoller(
  orch: DaemonOrchestrator,
  runtime: Pick<DaemonRuntimeAdapter, "prStatus">,
  intervalMs: number = DEFAULT_PR_STATUS_POLL_MS,
  hasSubscribers?: () => boolean,
  run: PrViewRunner = makeGhPrViewRunner(runtime.prStatus.classify, runtime.prStatus.viewFields),
  hasWorkingAgent?: () => boolean,
): ReturnType<typeof startTicker> {
  const schedule: PrPollSchedule = new Map()
  return startTicker({
    name: "pr-status-poller",
    tickMs: intervalMs,
    ...(hasSubscribers ? { gate: () => hasSubscribers() || (hasWorkingAgent?.() ?? false) } : {}),
    run: () =>
      runPrStatusPass(orch, {
        runtime,
        run,
        now: Date.now(),
        at: new Date().toISOString(),
        schedule,
        tickMs: intervalMs,
      }),
  })
}
