import { type PsSnapshot, engineProcessIn, parsePsSnapshot, psSnapshot } from "./foreground.ts"

/**
 * Is an engine process running inside this hosted session's tree right now?
 *
 * The one answer to "is the engine actually there", shared by every gate that
 * writes into a session and by the readiness poll that waits for one
 * ({@link import("./hosted-session-readiness.ts").awaitEngineProcess}, which
 * is this call in a loop). A hosted PTY stays alive after its engine exits —
 * keepAlive `exec`s a login shell in its place — so the session's own
 * liveness answers a different question, and a paste into that shell is
 * EXECUTED as shell commands rather than read.
 *
 * A failed `ps` reads as `false` here on purpose: for a gate, only a positive
 * walk may license a write. Readers must NOT reuse this — `false` from a
 * failed look would tell a cleanup loop a live task had stopped. They walk
 * one shared snapshot with {@link engineProcessIn} and publish the failure as
 * `null` (see `cli/api/runtime.ts`'s `taskTabs`).
 */
export async function sessionHasEngine(
  pid: number | null | undefined,
  extraLaunch?: string | readonly string[],
  snapshot: PsSnapshot = psSnapshot,
): Promise<boolean> {
  if (!pid) return false
  try {
    return engineProcessIn(parsePsSnapshot(await snapshot()), pid, extraLaunch)
  } catch {
    return false
  }
}
