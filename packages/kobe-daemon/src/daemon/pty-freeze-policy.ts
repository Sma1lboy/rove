/**
 * When a hosted PTY session's scrollback is worth writing to disk.
 *
 * One freeze re-encodes the WHOLE ring (512KB → ~683KB base64) however few
 * bytes moved, and engines repaint their status line at >=1 Hz mid-turn. A
 * plain 5s throttle against a measured 389-928 B/s of real engine output is a
 * 160x write amplification: 2.3 MB/s and 0.17 TB/day at 18 working sessions,
 * 25.6 MB/s at 200.
 */

/** Floor between periodic freeze writes. Exits and shutdowns flush immediately. */
export const FREEZE_INTERVAL_MS = 5_000

/**
 * Bytes appended before a periodic freeze is worth it, so writes scale with
 * the change, not the ring. An eighth of the ring: a session producing that
 * much per minute pays ~11x its output instead of 160x; slower ones fall to
 * {@link FREEZE_STALE_MS}; idle ones write nothing. Faster output (build log,
 * big `cat`) still freezes on the 5s floor.
 */
export const FREEZE_MIN_APPENDED_BYTES = 64 * 1024

/**
 * Max age of unfrozen output before the byte gate is overridden. This, not
 * {@link FREEZE_INTERVAL_MS}, bounds crash loss for an ordinary session: a
 * host crash/reboot/SIGKILL loses up to a minute of the ring's tail. Graceful
 * stops and exits flush in full, and the engine's `--resume` keeps the
 * conversation either way.
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
 * Whether a periodic freeze is worth its whole-ring rewrite at `now`. Forced
 * freezes (exit, rename, shutdown) skip this: an exit record is a change no
 * byte counter sees.
 */
export function shouldFreeze(session: FreezeGateState, now: number): boolean {
  const appended = session.totalBytes - (session.frozenTotalBytes ?? 0)
  if (appended <= 0) return false
  const since = now - session.lastFreezeAtMs
  if (since < FREEZE_INTERVAL_MS) return false
  return appended >= FREEZE_MIN_APPENDED_BYTES || since >= FREEZE_STALE_MS
}
