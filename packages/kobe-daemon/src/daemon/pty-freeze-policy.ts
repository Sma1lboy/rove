/**
 * WHEN a hosted PTY session's scrollback is worth writing to disk.
 *
 * `pty-host.ts` owns the set of sessions and `pty-freeze-store.ts` owns the
 * durable record; neither is the right home for the arithmetic that decides
 * whether a periodic write earns its cost, which is a policy with measured
 * numbers behind it and no dependency on either.
 *
 * The cost being rationed: one freeze re-encodes and rewrites the session's
 * WHOLE ring (512KB → ~683KB of base64), however few bytes moved. Engines
 * repaint their status line at >=1 Hz while a turn runs, so a plain 5s
 * throttle meant every working session rewrote its entire ring eleven times
 * a minute. Measured against a passively-observed 389-928 B/s of real engine
 * output, that is a 160x write amplification: 2.3 MB/s and 0.17 TB/day at 18
 * working sessions, 25.6 MB/s at 200.
 */

/** Floor between a session's periodic freeze writes. Exits and shutdowns
 *  flush immediately; this only rate-limits the live stream. */
export const FREEZE_INTERVAL_MS = 5_000

/**
 * Bytes a session must have appended before a periodic freeze is worth its
 * cost — the gate that makes the write scale with the CHANGE rather than
 * with the ring.
 *
 * 64KB is an eighth of the ring, so a session producing at least that much
 * per minute pays ~11x its own output rather than 160x; below that rate
 * {@link FREEZE_STALE_MS} governs instead, and a session producing nothing
 * writes nothing. A session emitting 64KB faster than
 * {@link FREEZE_INTERVAL_MS} — a build log, a `cat` of something big — still
 * freezes on the 5s floor exactly as before.
 */
export const FREEZE_MIN_APPENDED_BYTES = 64 * 1024

/**
 * How long a session may hold unfrozen output before the byte gate is
 * overridden. This — not {@link FREEZE_INTERVAL_MS} — is the crash-loss
 * bound for an ordinary working session: a host that dies (crash, reboot,
 * SIGKILL) loses at most this much of the ring's tail, where it used to lose
 * at most 5s. A graceful stop and every exit still flush in full, and the
 * engine's own `--resume` carries the conversation either way; what a crash
 * costs is up to a minute of terminal repaint at the very end of the
 * scrollback.
 */
export const FREEZE_STALE_MS = 60_000

/** The session fields the gate reads — `PtySessionState` satisfies it. */
export interface FreezeGateState {
  /** Monotonic total the child has ever written. */
  readonly totalBytes: number
  /** `totalBytes` as of the last persisted snapshot. Absent = none yet. */
  readonly frozenTotalBytes?: number
  /** Epoch ms of the last persisted snapshot. Zero = never. */
  readonly lastFreezeAtMs: number
}

/**
 * Whether a PERIODIC freeze is worth its whole-ring rewrite at `now`. Pure.
 *
 * Forced freezes (exit, rename, shutdown) do not consult this: an exit record
 * is a change no byte counter can see.
 */
export function shouldFreeze(session: FreezeGateState, now: number): boolean {
  const appended = session.totalBytes - (session.frozenTotalBytes ?? 0)
  if (appended <= 0) return false
  const since = now - session.lastFreezeAtMs
  if (since < FREEZE_INTERVAL_MS) return false
  return appended >= FREEZE_MIN_APPENDED_BYTES || since >= FREEZE_STALE_MS
}
