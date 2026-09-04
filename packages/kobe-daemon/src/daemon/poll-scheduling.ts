/**
 * Pure scheduling core for subprocess-backed background polling.
 *
 * It lives in `kobe-daemon` because BOTH sides need it and the dependency
 * arrow only runs one way: `kobe` depends on `kobe-daemon`, never the
 * reverse. When this module sat in `kobe/src/lib`, the daemon's two
 * collectors physically could not import it, so each carried its own
 * byte-identical copy of {@link maybeStartScheduledRun} — and the module doc
 * here still claimed they "reuse the EXACT guards", which had quietly stopped
 * being true. `kobe/src/lib/poll-scheduling.ts` is now a re-export, so every
 * TUI-side import path is unchanged.
 *
 * The three guards live here; the bindings differ only in where a finished
 * value goes:
 *
 *   - **in-flight dedupe** — one run per key at a time
 *     ({@link shouldPoll}); ticks landing mid-run are dropped.
 *   - **adaptive cadence** — the next run is allowed only after
 *     `max(minIntervalMs, 5 × last duration)` ({@link computeNextAllowedAt}):
 *     fast repos keep the tick cadence, slow-but-finishing repos self-thin.
 *   - **timeout + hard backoff** — a run exceeding `timeoutMs` is aborted
 *     (children spawned via {@link spawnCapture} get SIGKILLed) and the key
 *     backs off for `slowRetryMs`.
 *
 * Dependency-free apart from `node:child_process` — safe for the daemon,
 * vitest, and any render process.
 */

import { spawn } from "node:child_process"

/** The cadence knobs every scheduled-poll consumer must pin down. */
export interface PollCadenceConfig {
  /** Abort a run (and back off hard) after this long. */
  readonly timeoutMs: number
  /** After a timeout, leave the key alone for this long before retrying. */
  readonly slowRetryMs: number
  /** Floor between successful runs — typically the caller's tick cadence. */
  readonly minIntervalMs: number
}

/** Per-key scheduling state the guards read/write. */
export interface PollScheduleState {
  inFlight: boolean
  nextAllowedAt: number
}

/**
 * When the next run may start. Pure — exported for unit tests.
 * Timed-out runs back off hard; completed runs scale with their own
 * duration so slow repos self-thin without a special case.
 */
export function computeNextAllowedAt(
  startedAt: number,
  finishedAt: number,
  timedOut: boolean,
  cfg: { readonly slowRetryMs: number; readonly minIntervalMs: number },
): number {
  if (timedOut) return startedAt + cfg.slowRetryMs
  return finishedAt + Math.max(cfg.minIntervalMs, (finishedAt - startedAt) * 5)
}

/** Whether a run may start now. Pure — exported for unit tests. */
export function shouldPoll(state: { inFlight: boolean; nextAllowedAt: number }, now: number): boolean {
  return !state.inFlight && now >= state.nextAllowedAt
}

/**
 * Spread a delay by ± `ratio` so many keys coming due together (e.g. after a
 * network reconnect re-arms every poller at once) don't fire in lockstep.
 * `ratio` is clamped to `[0, 1]`; the result lands in
 * `[delayMs·(1−ratio), delayMs·(1+ratio))` and is never negative. `rand`
 * defaults to `Math.random` and is injectable so tests are deterministic
 * (`() => 0.5` yields exactly `delayMs`, the no-jitter midpoint). Pure.
 */
export function applyJitter(delayMs: number, ratio: number, rand: () => number = Math.random): number {
  const r = Math.max(0, Math.min(1, ratio))
  const offset = (rand() * 2 - 1) * delayMs * r
  return Math.max(0, delayMs + offset)
}

/**
 * Exponential backoff capped at `capMs`: `baseMs · 2^attempt`, with `attempt`
 * the zero-based retry index (0 → `baseMs`, 1 → `2·baseMs`, …). Negative
 * attempts clamp to `baseMs`; the result never exceeds `capMs`. Pure —
 * exported for unit tests.
 */
export function exponentialBackoff(baseMs: number, attempt: number, capMs: number): number {
  if (attempt <= 0) return Math.min(baseMs, capMs)
  return Math.min(baseMs * 2 ** attempt, capMs)
}

/**
 * Maybe start one guarded background run for a key's schedule state.
 * Returns `false` (no run) when the guards say no — in flight, or inside
 * the cadence/backoff window. Otherwise marks the state in-flight, runs
 * `run` with an AbortSignal that fires at `timeoutMs` (pass it to
 * {@link spawnCapture} so a runaway child is SIGKILLed), and on settle
 * updates `nextAllowedAt` + clears the in-flight flag.
 *
 * Failure contract (same as the TUI poller it was extracted from): a run
 * that throws, is aborted, or resolves after the timeout never calls
 * `onValue` — the consumer keeps its last good value, so UIs go stale or
 * stay hidden rather than erroring.
 */
export function maybeStartScheduledRun<T>(
  state: PollScheduleState,
  cfg: PollCadenceConfig,
  run: (signal: AbortSignal) => Promise<T>,
  onValue: (value: T) => void,
): boolean {
  const startedAt = Date.now()
  if (!shouldPoll(state, startedAt)) return false
  state.inFlight = true
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
  void (async () => {
    let value: T | undefined
    let ok = false
    try {
      value = await run(controller.signal)
      ok = true
    } catch {
      // Keep the last value — the consumer goes stale, never errors.
    }
    clearTimeout(timer)
    const timedOut = controller.signal.aborted
    state.nextAllowedAt = computeNextAllowedAt(startedAt, Date.now(), timedOut, cfg)
    state.inFlight = false
    if (ok && !timedOut) onValue(value as T)
  })()
  return true
}

export interface SpawnCaptureResult {
  /** Exit code, or null when the child errored / was killed (timeout). */
  readonly status: number | null
  readonly stdout: string
  /**
   * Captured stderr. Kept because on a non-zero status it is usually the ONLY
   * thing that says why — `sync-base.ts` used to report a refused merge as a
   * bare "git merge <ref> failed" because this was thrown away at the pipe.
   */
  readonly stderr: string
}

/**
 * Decode captured stdout chunks to one UTF-8 string. Chunks MUST be joined as
 * bytes before decoding: a stdout pipe splits on an arbitrary byte boundary
 * (~64 KB), so a multi-byte UTF-8 sequence (a non-ASCII path with
 * `core.quotepath=false`, or any commit message / diff body git never quotes)
 * can straddle two chunks. Decoding each chunk on its own — `String(chunk)` —
 * turns the split character into replacement bytes (`�`); concatenating
 * the raw bytes first decodes it intact. Pure — exported for unit tests.
 */
export function decodeCapturedChunks(chunks: readonly (Buffer | string)[]): string {
  return Buffer.concat(chunks.map((c) => (typeof c === "string" ? Buffer.from(c) : c))).toString("utf8")
}

/**
 * Async spawn that collects stdout AND stderr and resolves on close. Never rejects —
 * a spawn error (missing cwd, binary not on PATH) or an abort resolves
 * with `status: null` so callers branch on status, mirroring the
 * never-throw contract of the pane-side sync git helpers it replaces.
 * The AbortSignal kills the child with SIGKILL.
 */
export function spawnCapture(
  cmd: string,
  args: readonly string[],
  opts: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv; readonly signal: AbortSignal },
): Promise<SpawnCaptureResult> {
  return new Promise((resolve) => {
    const chunks: (Buffer | string)[] = []
    const errChunks: (Buffer | string)[] = []
    let settled = false
    const finish = (status: number | null): void => {
      if (settled) return
      settled = true
      resolve({ status, stdout: decodeCapturedChunks(chunks), stderr: decodeCapturedChunks(errChunks) })
    }
    const child = spawn(cmd, args.slice(), {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: opts.env,
      signal: opts.signal,
      killSignal: "SIGKILL",
    })
    child.stdout?.on("data", (chunk: Buffer | string) => {
      chunks.push(chunk)
    })
    child.stderr?.on("data", (chunk: Buffer | string) => {
      errChunks.push(chunk)
    })
    child.on("error", () => finish(null))
    child.on("close", (code) => finish(code))
  })
}
