/**
 * Pure scheduling core for subprocess-backed background polling. Lives in
 * `kobe-daemon` because both sides need it and `kobe` depends on
 * `kobe-daemon`, never the reverse; `kobe/src/lib/poll-scheduling.ts`
 * re-exports it.
 *
 * The three guards (bindings differ only in where a finished value goes):
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

/** When the next run may start: timed-out runs back off hard; completed runs
 *  scale with their own duration. */
export function computeNextAllowedAt(
  startedAt: number,
  finishedAt: number,
  timedOut: boolean,
  cfg: { readonly slowRetryMs: number; readonly minIntervalMs: number },
): number {
  if (timedOut) return startedAt + cfg.slowRetryMs
  return finishedAt + Math.max(cfg.minIntervalMs, (finishedAt - startedAt) * 5)
}

/** Whether a run may start now. */
export function shouldPoll(state: { inFlight: boolean; nextAllowedAt: number }, now: number): boolean {
  return !state.inFlight && now >= state.nextAllowedAt
}

/**
 * Spread a delay by ± `ratio` so keys due together (e.g. after a reconnect)
 * don't fire in lockstep. `ratio` clamps to `[0, 1]`; result is in
 * `[delayMs·(1−ratio), delayMs·(1+ratio))`, never negative. `rand: () => 0.5`
 * yields exactly `delayMs`.
 */
export function applyJitter(delayMs: number, ratio: number, rand: () => number = Math.random): number {
  const r = Math.max(0, Math.min(1, ratio))
  const offset = (rand() * 2 - 1) * delayMs * r
  return Math.max(0, delayMs + offset)
}

/** `baseMs · 2^attempt` capped at `capMs`; `attempt` is the zero-based retry
 *  index, negatives clamp to `baseMs`. */
export function exponentialBackoff(baseMs: number, attempt: number, capMs: number): number {
  if (attempt <= 0) return Math.min(baseMs, capMs)
  return Math.min(baseMs * 2 ** attempt, capMs)
}

/**
 * Start one guarded run, or return `false` when in flight / inside the
 * cadence or backoff window. `run` gets an AbortSignal firing at `timeoutMs`
 * (pass it to {@link spawnCapture} so a runaway child is SIGKILLed).
 *
 * A run that throws, aborts, or resolves after the timeout never calls
 * `onValue`: the consumer keeps its last good value (stale, never erroring).
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
  /** On a non-zero status, usually the ONLY thing that says why. */
  readonly stderr: string
}

/**
 * Decode captured chunks to one UTF-8 string. Join as bytes FIRST: a pipe
 * splits on an arbitrary byte boundary (~64 KB), so a multi-byte sequence can
 * straddle chunks and per-chunk decoding would emit `�`.
 */
export function decodeCapturedChunks(chunks: readonly (Buffer | string)[]): string {
  return Buffer.concat(chunks.map((c) => (typeof c === "string" ? Buffer.from(c) : c))).toString("utf8")
}

/**
 * Async spawn collecting stdout AND stderr, resolving on close. Never rejects:
 * a spawn error (missing cwd, binary not on PATH) or abort resolves
 * `status: null`. The AbortSignal kills the child with SIGKILL.
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
