/**
 * Asking an engine's session store two questions a tab needs answered:
 * "which session is mine?" and "does the one I recorded still exist?".
 *
 * Both are the IO half of `session-identity.ts` (which is pure policy), and
 * both go through `EngineHistoryReader.listSessionIdsForWorktree` — the one
 * method EVERY built-in implements, including the readers that ship no
 * message parser.
 *
 * That last point is the whole reason this module exists. The existence
 * check used to be `readHistory(id).length > 0`, which silently means "this
 * engine has a message parser": kimi's reader is paths-only, so every kimi
 * tab answered "your session does not exist", never set `spawned`, and
 * respawned blank on restart even once its id was known. Listing ids is the
 * question actually being asked, and every engine can answer it.
 */

import { type VendorId, coerceVendorId } from "../types/vendor.ts"
import { engineEntry } from "./registry.ts"
import { pickUnclaimedSessionId } from "./session-identity.ts"

/** Session ids this engine recorded for `worktree`, oldest-first; `[]` on error. */
async function sessionIds(vendor: VendorId | undefined, worktree: string): Promise<readonly string[]> {
  if (!worktree) return []
  try {
    return await engineEntry(coerceVendorId(vendor)).history.listSessionIdsForWorktree(worktree)
  } catch {
    // Readers are best-effort by contract; an unreadable store is "no
    // evidence", never an error the tab has to handle.
    return []
  }
}

/**
 * True when `sessionId` is still recorded in this engine's store for
 * `worktree` — i.e. the tab has a conversation worth resuming.
 */
export async function engineSessionExists(
  vendor: VendorId | undefined,
  worktree: string,
  sessionId: string,
): Promise<boolean> {
  if (!sessionId) return false
  return (await sessionIds(vendor, worktree)).includes(sessionId)
}

/**
 * The session id to adopt for a tab that has none — the newest one this
 * engine recorded for `worktree` that no sibling tab already claims, or
 * null when the store is empty or every session is spoken for.
 *
 * This is origin (3) in `session-identity.ts`: the only way to learn the id
 * of an engine that mints its own and reports it nowhere (kimi). It is
 * deliberately the LAST resort — a pinned id (claude) or one the engine put
 * in its own title (codex) is authoritative and never reaches here, because
 * those tabs already have a `sessionId`.
 */
export async function discoverSessionId(
  vendor: VendorId | undefined,
  worktree: string,
  claimed: ReadonlySet<string>,
): Promise<string | null> {
  return pickUnclaimedSessionId(await sessionIds(vendor, worktree), claimed)
}
