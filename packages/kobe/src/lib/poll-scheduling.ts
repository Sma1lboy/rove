/**
 * Re-export of the scheduling core, which now lives in `kobe-daemon` so the
 * daemon's collectors can import the same module instead of copying it (the
 * dependency arrow runs kobe → kobe-daemon, never back). Kept as a shim
 * because `src/tui/lib/background-poll.ts`, `src/monitor/pr-status.ts`,
 * `src/core/daemon-runtime.ts` and `src/engine/claude-code-local/quota.ts`
 * all import from here.
 *
 * @public — the type re-exports are consumed by `kobe-daemon`'s collectors
 * across the package boundary, which knip's `packages/kobe` scope cannot see.
 */

export {
  type PollCadenceConfig,
  type PollScheduleState,
  type SpawnCaptureResult,
  applyJitter,
  computeNextAllowedAt,
  decodeCapturedChunks,
  exponentialBackoff,
  maybeStartScheduledRun,
  shouldPoll,
  spawnCapture,
} from "@sma1lboy/kobe-daemon/daemon/poll-scheduling"
