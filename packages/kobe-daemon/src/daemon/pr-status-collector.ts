/**
 * Daemon-side PR-status poller.
 *
 * For every task with a real branch + local worktree, shell
 * `gh pr list --head <branch> --state all --json …` on an interval, map the
 * result to a neutral {@link TaskPRStatus}, and write it through
 * `orch.setPRStatus` → `store.update` → the `task.snapshot` broadcast.
 * Persisting on the Task (rather than a bespoke channel like the
 * worktree-changes collector) means the existing push fans the chip to every
 * Tasks pane + the web board for free, and the status survives a daemon
 * restart. The TUI sidebar renders the check-state chip and — mirroring
 * `useCompletionNotifications` — fires a toast/bell when a task's checks
 * resolve (pending → passing/failing); the poller itself only persists.
 *
 * `gh pr list --head` (not `gh pr view`) so "no PR for this branch" is a
 * SUCCESS result (exit 0, empty JSON array) instead of a guessed-at exit-1
 * stderr pattern. A branch can carry more than one PR (an old closed one plus
 * a fresh open one); the strongest wins: open > merged/closed by
 * most-recently-updated (see {@link pickPr}).
 *
 * The failure classifier (`gh` missing/unauthed/network/etc — the "gh broke"
 * case, as opposed to the structural "no PR" case above) and the `--json`
 * field set are OWNED by `@sma1lboy/kobe`'s `monitor/pr-status.ts` (that's
 * where the full pattern tables + unit tests live) and reached through
 * `runtime.prStatus.classify` / `runtime.prStatus.viewFields` — the same
 * consumer-owned-runtime seam `mapView`/`sameStatus`/`nextPoll` already use.
 * kobe-daemon has no dependency on the `kobe` package, so this indirection
 * (not a direct import) is how the daemon reuses kobe's tested logic without
 * inverting the package graph.
 *
 * GitHub only: the runner is `gh`, so remote (`ssh://`) projects and
 * non-GitHub remotes simply yield no PR and are cheap no-ops.
 *
 * Cost control — a per-task schedule keyed off the outcome:
 *   - has an open PR  → re-poll at tick cadence (checks move).
 *   - merged / closed → {@link SETTLED_BACKOFF_MS} (the PR is done).
 *   - no PR (gh ran, empty array) → {@link NO_PR_BACKOFF_MS} (a branch rarely
 *                       sprouts a PR between ticks).
 *   - `gh`/transport ERROR (missing, unauthed, timeout, network, bad JSON, or
 *                       ANY unrecognized non-zero exit) → EXPONENTIAL backoff
 *                       capped at {@link PR_FAILURE_CAP_MS}, so a persistent
 *                       failure (gh missing) stops re-spawning at full rate,
 *                       and the failure kind is logged so it's diagnosable.
 *   - no GitHub remote (deterministic) → {@link NO_REMOTE_BACKOFF_MS} long idle
 *                       cadence (it will never have a GitHub PR — no retry storm).
 * Every scheduled delay is JITTERED ({@link PR_POLL_JITTER_RATIO}) so N tasks
 * coming due together (a network reconnect re-arming every task) don't poll in
 * lockstep.
 *
 * A status is only ever WRITTEN from a successful `gh pr list` (exit 0, a
 * non-empty array); an error or empty keeps the last value, so a transient
 * auth/network blip never clobbers a known chip. A non-zero exit is ALWAYS an
 * `error` — "no PR" only comes from the structural empty-array success path,
 * never from a guessed stderr pattern, so a `gh` failure cannot silently
 * masquerade as "no PR". Best-effort, at most
 * {@link PR_POLL_CONCURRENCY} `gh` calls in flight; a per-task failure is
 * logged, never fatal, never blocks the other tasks in the pass.
 */

import { spawn } from "node:child_process"
import type { DaemonOrchestrator, DaemonTask as Task } from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
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
 * Pick the PR that best represents a branch's status from `gh pr list`'s
 * (possibly multi-PR) result: an open PR wins over merged/closed; ties (incl.
 * merged vs closed) keep the first entry, which `gh pr list` already returns
 * most-recently-updated-first. Empty input → undefined ("no PR").
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

/** Default re-scan cadence. PR checks move on the order of seconds-to-minutes;
 * 30s is responsive without hammering `gh` (which hits the network). */
export const DEFAULT_PR_STATUS_POLL_MS = 30_000
/** Re-poll backoff for a branch with no PR yet. */
export const NO_PR_BACKOFF_MS = 5 * 60_000
/** Re-poll backoff once a PR is merged/closed — effectively done. */
export const SETTLED_BACKOFF_MS = 10 * 60_000
/** First transient-failure backoff (doubles per consecutive failure). */
export const PR_FAILURE_BASE_MS = DEFAULT_PR_STATUS_POLL_MS
/** Cap on the exponential failure backoff — a persistently broken `gh`
 * (missing/unauthed) settles here instead of spawning every tick. */
export const PR_FAILURE_CAP_MS = 15 * 60_000
/** Deterministic "no GitHub remote" idle cadence — this repo will never have a
 * GitHub PR, so re-checking it more than rarely is pure waste. */
export const NO_REMOTE_BACKOFF_MS = 30 * 60_000
/** ± jitter ratio on every scheduled delay (de-syncs N tasks after a reconnect). */
export const PR_POLL_JITTER_RATIO = 0.2
/** Kill a `gh pr list` that hangs past this (network stall). */
export const PR_VIEW_TIMEOUT_MS = 10_000

/**
 * How many `gh pr list` calls one pass may have in flight.
 *
 * A pass used to await each task in turn, and `startTicker` drops any tick
 * arriving while one is still running — so the real per-task refresh was
 * `max(tickMs, N × gh_latency)`, not the {@link DEFAULT_PR_STATUS_POLL_MS}
 * this module documents. Measured at 800ms per call, one pass took 42s at 50
 * tasks and 170s at 200, all of it one child at a time.
 *
 * 8 keeps 200 tasks inside a single tick while staying far below any
 * fd/process ceiling. `gh` waits on the network rather than the CPU, so
 * serialising it was never buying back a real constraint; the per-task
 * backoffs in `nextPoll` are what actually bound how often it runs, and they
 * are untouched.
 */
export const PR_POLL_CONCURRENCY = 8

/**
 * The outcome of one `gh pr list --head <branch>`:
 *   - `pr`    — {@link pickPr} chose a payload (the only case that WRITES a status).
 *   - `empty` — gh ran (exit 0) and the branch genuinely has no PR.
 *   - `error` — a `gh`/transport failure (typed by {@link PrViewErrorKind}):
 *               gh missing/unauthed, a timeout, a network blip, bad JSON, no
 *               GitHub remote, or ANY OTHER non-zero exit. Distinguishing this
 *               from `empty` is the whole point — an error keeps the last
 *               status + logs *why* it's stale, instead of masquerading as
 *               "no PR".
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

/**
 * Decode captured spawn chunks to one UTF-8 string. Chunks MUST be joined as
 * bytes before decoding: a stdout pipe splits on an arbitrary byte boundary
 * (~64 KB), so a multi-byte UTF-8 sequence — a non-ASCII PR title inside the
 * `gh … --json` payload — can straddle two chunks. Decoding each chunk on its
 * own (`String(chunk)`) turns the split character into replacement bytes
 * (`�`); concatenating the raw bytes first decodes it intact. Mirrors
 * `@sma1lboy/kobe`'s `decodeCapturedChunks` — the daemon can't import across
 * the package boundary (see the file header). Pure — exported for unit tests.
 */
export function decodeSpawnChunks(chunks: readonly (Buffer | string)[]): string {
  return Buffer.concat(chunks.map((c) => (typeof c === "string" ? Buffer.from(c) : c))).toString("utf8")
}

/** Spawn `gh` capturing stdout AND stderr (needed to classify the failure).
 * Never rejects: a spawn error or abort resolves with `status: null` so the
 * caller branches on the captured signals rather than a thrown error. */
export function spawnGh(args: readonly string[], cwd: string, signal: AbortSignal): Promise<GhSpawnResult> {
  return new Promise((resolve) => {
    const outChunks: (Buffer | string)[] = []
    const errChunks: (Buffer | string)[] = []
    let settled = false
    const finish = (status: number | null, spawnError: boolean): void => {
      if (settled) return
      settled = true
      resolve({ status, stdout: decodeSpawnChunks(outChunks), stderr: decodeSpawnChunks(errChunks), spawnError })
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

/** The `runtime.prStatus.classify` shape this module consumes — structurally
 * the same as `monitor/pr-status.ts`'s `classifyGhFailure` (see the file
 * header for why this is an injected function, not an import). */
type GhFailureClassifier = DaemonRuntimeAdapter["prStatus"]["classify"]

/**
 * Build the real `gh` runner. Exit 0 with a parseable JSON array → {@link pickPr}
 * (empty array → structural `empty`, a genuine success — never inferred from a
 * failure); any non-zero exit or unparseable JSON → `classify` (typed
 * `error`, no "empty" fallback — see the file header). Never throws.
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

/** A task eligible for PR polling: a real branch on a LOCAL worktree. `main`
 * rows (no branch) and remote projects are skipped. Pure — unit-tested. */
export function isPrPollable(task: Task): boolean {
  if (task.kind === "main") return false
  if (!task.branch || !task.worktreePath) return false
  if (task.repo.startsWith("ssh://") || task.worktreePath.startsWith("ssh://")) return false
  return true
}

/** Per-task scheduling state: next-allowed-at + the consecutive-failure streak
 * that drives exponential backoff. Reset to `failures: 0` on any success / empty
 * / no-remote. */
export interface PrPollEntry {
  readonly nextAllowedAt: number
  readonly failures: number
}

/** Per-task schedule, keyed by task id. Carried across passes by the live poller. */
export type PrPollSchedule = Map<string, PrPollEntry>

export interface PrStatusPassOptions {
  readonly runtime: Pick<DaemonRuntimeAdapter, "prStatus">
  readonly run: PrViewRunner
  /** `Date.now()`-style clock (ms). Injected so tests are deterministic. */
  readonly now: number
  /** ISO timestamp stamped onto each status. Injected for the same reason. */
  readonly at: string
  /** Per-task backoff state, carried across passes by the live poller. */
  readonly schedule: PrPollSchedule
  readonly tickMs?: number
  /** `Math.random`-style source for jitter. Injected so tests are deterministic
   * (`() => 0.5` cancels the jitter to the exact base delay). */
  readonly rand?: () => number
}

/**
 * Write (or clear) the reason the last poll failed on the task's LAST GOOD
 * status. The chip keeps its value — a transient `gh` blip must not clobber a
 * good reading — and gains a marker saying the value is no longer being
 * refreshed. Returns whether anything was persisted.
 *
 * Nothing to mark when the task has no PR status: a staleness marker on a chip
 * that is not drawn tells nobody anything.
 *
 * `samePrStatus` deliberately ignores `lastError`, so the poller's own diff can
 * neither carry this write nor suppress it — the change check lives here, and
 * it is what keeps a long outage from re-persisting and re-broadcasting on
 * every backoff tick.
 */
async function setPrStaleMarker(orch: DaemonOrchestrator, taskId: string, error: string | undefined): Promise<boolean> {
  const prev = orch.getTask(taskId)?.prStatus
  if (!prev || prev.lastError === error) return false
  const { lastError: _cleared, ...rest } = prev
  await orch.setPRStatus(taskId, error === undefined ? rest : { ...rest, lastError: error })
  return true
}

/**
 * Run one polling pass over every eligible task whose backoff has elapsed.
 * Returns the ids whose persisted status actually changed (for tests). Pure
 * orchestrator work — no timers, no `Date.now()`.
 */
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
  // Drop entries for tasks that are GONE, not merely ineligible. The delete
  // below only fires for ids still in `listTasks()`, so a deleted task's entry
  // had no exit at all — unbounded over a long-lived daemon.
  const live = new Set(tasks.map((task) => task.id))
  for (const id of opts.schedule.keys()) {
    if (!live.has(id)) opts.schedule.delete(id)
  }
  // Selection is synchronous and happens against ONE `opts.now`, before any
  // `gh` runs — so which tasks are due does not depend on how long the pass
  // takes, the way it would if the filter were interleaved with the awaits.
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
        // A real gh/transport failure — NOT "no PR". Keep the last value (don't
        // clobber a good chip with a transient blip), log why it's stale so it's
        // diagnosable, and back off (exponential for transients; a long idle
        // cadence for the deterministic no-remote case).
        logDaemonInfo(
          "pr-status-poller",
          `gh pr list failed (${result.error}) for task ${task.id} [${task.branch}] — keeping last PR status, backing off`,
        )
        // The log alone left the chip claiming a fact nobody was refreshing.
        const marked = await setPrStaleMarker(orch, task.id, result.error)
        opts.schedule.set(
          task.id,
          opts.runtime.prStatus.nextPoll({ kind: "error", error: result.error }, prevFailures, opts.now, cfg, rand),
        )
        return marked ? task.id : undefined
      }
      if (result.kind === "empty") {
        // gh ran and there is genuinely no PR yet. Keep the last value; back off
        // (a branch rarely sprouts a PR between ticks). `gh` reaching the
        // provider is what clears the stale marker, not the answer it gave.
        const marked = await setPrStaleMarker(orch, task.id, undefined)
        opts.schedule.set(task.id, opts.runtime.prStatus.nextPoll({ kind: "empty" }, prevFailures, opts.now, cfg, rand))
        return marked ? task.id : undefined
      }
      const next = opts.runtime.prStatus.mapView(result.view, opts.at)
      // Re-read under the live store (the task may have been deleted
      // during the await) and diff before writing.
      const current = orch.getTask(task.id)
      if (!current) {
        opts.schedule.delete(task.id)
        return undefined
      }
      // `sameStatus` ignores `lastError`, so an otherwise-identical status
      // would leave a stale marker on a chip that just polled cleanly. `next`
      // never carries one, so writing it IS the clear.
      const wasStale = current.prStatus?.lastError !== undefined
      let changedId: string | undefined
      if (wasStale || !opts.runtime.prStatus.sameStatus(current.prStatus, next ?? undefined)) {
        await orch.setPRStatus(task.id, next)
        changedId = task.id
      }
      // A merged/closed PR is done — poll it rarely; an open one tracks checks.
      const settled = next?.lifecycle === "merged" || next?.lifecycle === "closed"
      opts.schedule.set(
        task.id,
        opts.runtime.prStatus.nextPoll({ kind: "pr", settled }, prevFailures, opts.now, cfg, rand),
      )
      return changedId
    } catch (err) {
      // The injected runner threw (the real one never does). Treat as a
      // transient error so it backs off rather than hammering.
      logDaemonError("pr-status-poller", err)
      const marked = await setPrStaleMarker(orch, task.id, "network").catch(() => false)
      opts.schedule.set(
        task.id,
        opts.runtime.prStatus.nextPoll({ kind: "error", error: "network" }, prevFailures, opts.now, cfg, rand),
      )
      return marked ? task.id : undefined
    }
  }

  // Fixed-size worker pool over `due`. Results land in their task's own slot,
  // so the returned ids stay in task order however the polls interleave.
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
 * Start the live poller. Returns a `stop()` clearing the interval. Pass
 * `intervalMs <= 0` to disable (no-op stop).
 *
 * The consumer gate is `hasSubscribers() || hasWorkingAgent()`. `prStatus` is
 * the ONLY CI truth Rove holds, and a gate of "no GUI ⇒ nobody wants this"
 * assumes every consumer is a human at a pane. An agent working unattended is
 * a consumer too, and it is the one whose need is sharpest: an unattended run
 * is precisely when there is no GUI, so a GUI-only gate leaves `checkState`
 * stale or missing at the exact moment a worker asks whether its PR is green
 * — one mechanism behind "CI is green" being asserted from a local test run.
 *
 * `hasWorkingAgent` is the engine-activity registry (`currentNonIdle()`), fed
 * by the ungated `engine.reportEvent` hook path, so it is a free in-memory
 * read that needs no network and no pane. It keeps the gate's point intact —
 * a daemon with no GUI **and** no live engine still polls nobody, which is
 * the parked-daemon case the gate exists for.
 */
export function startPrStatusPoller(
  orch: DaemonOrchestrator,
  runtime: Pick<DaemonRuntimeAdapter, "prStatus">,
  intervalMs: number = DEFAULT_PR_STATUS_POLL_MS,
  hasSubscribers?: () => boolean,
  run: PrViewRunner = makeGhPrViewRunner(runtime.prStatus.classify, runtime.prStatus.viewFields),
  hasWorkingAgent?: () => boolean,
): () => void {
  const schedule: PrPollSchedule = new Map()
  return startTicker({
    name: "pr-status-poller",
    tickMs: intervalMs,
    // Two-term gate: an unattended agent is the consumer that needs CI truth
    // most, so a live engine opens it even with no pane attached.
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
