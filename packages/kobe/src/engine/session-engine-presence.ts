import type { VendorId } from "../types/vendor.ts"
import { type PsSnapshot, engineProcessIn, foregroundEngineIn, parsePsSnapshot, psSnapshot } from "./foreground.ts"

/**
 * What the process walk found: an engine, nothing, or no answer at all.
 *
 * `unknown` = `ps` failed or timed out; collapsing it into "none" would turn
 * a failed LOOK into a false "engine exited into a plain shell".
 */
export type EnginePresence =
  | { readonly kind: "engine"; readonly vendor: VendorId | null }
  | { readonly kind: "none" | "unknown" }

/**
 * Is an engine process running inside this hosted session's tree right now?
 *
 * Shared by every gate that writes into a session and by
 * {@link import("./hosted-session-readiness.ts").awaitEngineProcess}. Session
 * liveness is not the answer: keepAlive `exec`s a login shell after the
 * engine exits, and a paste into it EXECUTES as commands.
 *
 * A missing pid is `"none"`: no tree to walk is an answer.
 */
export async function enginePresence(
  pid: number | null | undefined,
  extraLaunch?: string | readonly string[],
  snapshot: PsSnapshot = psSnapshot,
): Promise<EnginePresence> {
  if (!pid) return { kind: "none" }
  try {
    const rows = parsePsSnapshot(await snapshot([pid]))
    const engine = foregroundEngineIn(rows, pid)
    if (engine) return { kind: "engine", vendor: engine.vendor }
    return engineProcessIn(rows, pid, extraLaunch) ? { kind: "engine", vendor: null } : { kind: "none" }
  } catch {
    return { kind: "unknown" }
  }
}
