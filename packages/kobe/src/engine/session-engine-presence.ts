import { type PsSnapshot, engineProcessIn, parsePsSnapshot, psSnapshot } from "./foreground.ts"

/**
 * A hosted PTY can remain alive after its engine exits because keepAlive drops
 * it into a fallback shell. Delivery must therefore verify the current process
 * tree instead of trusting the session's original launch command.
 */
export async function sessionHasEngine(
  pid: number | null | undefined,
  extraBin?: string,
  snapshot: PsSnapshot = psSnapshot,
): Promise<boolean> {
  if (!pid) return false
  try {
    return engineProcessIn(parsePsSnapshot(await snapshot()), pid, extraBin)
  } catch {
    return false
  }
}
