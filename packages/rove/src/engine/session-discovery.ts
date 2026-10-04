/**
 * IO half of `session-identity.ts`: "which session is mine?" and "does the one
 * I recorded still exist?". Both go through
 * `EngineHistoryReader.listSessionIdsForWorktree`, the one method every
 * built-in implements. Testing existence with `readHistory(id).length > 0`
 * would require a message parser: kimi's reader is paths-only, so every kimi
 * tab would read "missing", never set `spawned`, and respawn blank on restart.
 */

import type { VendorId } from "../types/vendor.ts"
import { protocolEntry } from "./engine-presets.ts"
import { pickUnclaimedSessionId } from "./session-identity.ts"

/** Session ids this engine recorded for `worktree`, oldest-first; `[]` on error. */
async function sessionIds(vendor: VendorId | undefined, worktree: string): Promise<readonly string[]> {
  if (!worktree) return []
  try {
    return await protocolEntry(vendor).history.listSessionIdsForWorktree(worktree)
  } catch {
    // Readers are best-effort by contract: an unreadable store is "no evidence".
    return []
  }
}

/** True when `sessionId` is still recorded for `worktree`, i.e. worth resuming. */
export async function engineSessionExists(
  vendor: VendorId | undefined,
  worktree: string,
  sessionId: string,
): Promise<boolean> {
  if (!sessionId) return false
  return (await sessionIds(vendor, worktree)).includes(sessionId)
}

/**
 * Id to adopt for a tab that has none: the newest one recorded for `worktree`
 * that no sibling tab claims, else null. Origin (3) in `session-identity.ts`,
 * the last resort for engines that mint ids and report them nowhere (kimi);
 * pinned (claude) and title-reported (codex) ids never reach here.
 */
export async function discoverSessionId(
  vendor: VendorId | undefined,
  worktree: string,
  claimed: ReadonlySet<string>,
): Promise<string | null> {
  return pickUnclaimedSessionId(await sessionIds(vendor, worktree), claimed)
}
