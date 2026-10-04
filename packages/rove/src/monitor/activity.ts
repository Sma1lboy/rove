/**
 * Engine-conversation activity probe: the newest transcript mtime for a
 * worktree advances when the agent writes output. Read from the engine's own
 * transcript store rather than by parsing the pane (fragile, racy). Thin
 * wrapper over `EngineHistoryReader.latestTranscriptMtimeForWorktree`.
 */

import { protocolEntry } from "@/engine/engine-presets"
import type { VendorId } from "@/types/task"

/**
 * Newest transcript mtime (epoch ms) for `worktree` under `vendor`, or 0 =
 * "no activity seen". Never throws. A custom engine gets the registry's EMPTY
 * reader (always 0), so it never mis-reads another engine's store.
 */
export async function latestTranscriptMtime(vendor: VendorId, worktree: string): Promise<number> {
  if (!worktree) return 0
  return protocolEntry(vendor).history.latestTranscriptMtimeForWorktree(worktree)
}
