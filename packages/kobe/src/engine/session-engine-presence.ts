import { type PsSnapshot, engineProcessIn, parsePsSnapshot, psSnapshot } from "./foreground.ts"

/**
 * What the process walk found: an engine, nothing, or no answer at all.
 *
 * The third case is the one worth a name. A `ps` that fails or blows its
 * deadline tells you nothing about the session, and collapsing it into
 * "no engine" turns a failed LOOK into a confident claim about the world —
 * which is how `send` came to tell users "its engine exited into a plain
 * shell" about a tab whose engine was running fine.
 */
export type EnginePresence = "engine" | "none" | "unknown"

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
 * A missing pid is `"none"`: there is no tree to walk, which is an answer.
 */
export async function enginePresence(
  pid: number | null | undefined,
  extraLaunch?: string | readonly string[],
  snapshot: PsSnapshot = psSnapshot,
): Promise<EnginePresence> {
  if (!pid) return "none"
  try {
    return engineProcessIn(parsePsSnapshot(await snapshot([pid])), pid, extraLaunch) ? "engine" : "none"
  } catch {
    return "unknown"
  }
}

/**
 * {@link enginePresence} collapsed for a GATE: only a positive walk licenses a
 * write, so both "none" and "unknown" refuse. Deliberate — a prompt pasted
 * into a bare shell is executed, and that must not happen because a probe
 * hiccupped.
 *
 * Callers that REPORT the verdict to a human must use {@link enginePresence}
 * instead and say which of the two it was. Readers (liveness, cleanup) must
 * use neither: `false` from a failed look would tell them a live task stopped.
 * They walk one shared snapshot with {@link engineProcessIn} and publish the
 * failure as `null` (see `cli/api/runtime.ts`'s `taskTabs`).
 */
export async function sessionHasEngine(
  pid: number | null | undefined,
  extraLaunch?: string | readonly string[],
  snapshot: PsSnapshot = psSnapshot,
): Promise<boolean> {
  return (await enginePresence(pid, extraLaunch, snapshot)) === "engine"
}
