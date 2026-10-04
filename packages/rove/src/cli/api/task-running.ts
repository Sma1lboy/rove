/**
 * The `.running` rule published by `get-task`/`collect` and acted on by
 * unattended loops. `tab-snapshot.ts` builds rows from the same inputs.
 */

import { isHostedTaskKey, sessionArgvNamesEngine } from "../../engine/hosted-session.ts"
import type { TabsState } from "../../tui/workspace/terminal-tabs-core.ts"
import type { TaskSessionRow } from "./tab-snapshot.ts"

/**
 * RUNNING = ANY engine tab (not just tab-1) has a live hosted session with an
 * engine in it, not merely a live PTY. `tab-1` is a snapshot-free floor: always
 * an engine tab (`initialTabs`), so it counts even if the snapshot write
 * failed. Non-engine tabs never count — same rule delivery uses.
 *
 * Engine-ness is the persisted `kind: "engine"` label OR
 * {@link sessionArgvNamesEngine} on the live session (the same judgement
 * `findHostedEngineKey` uses for delivery) — a session the snapshot lost has no
 * label, while only the label recognises a custom engine whose wrapper names
 * no known binary.
 *
 * `engineAlive` is the process half: keepAlive keeps the PTY after the engine
 * is reaped. Only an explicit `false` excludes; unknown counts as running — "couldn't look" never reads
 * as stopped.
 */
export function hasLiveEngineTab(
  snapshot: TabsState | undefined,
  taskId: string,
  sessions: readonly TaskSessionRow[],
  engineAlive?: ReadonlyMap<string, boolean>,
  engineBin?: string,
): boolean {
  const labelled = new Set((snapshot?.tabs ?? []).filter((t) => t.kind === "engine").map((t) => t.id))
  return sessions.some((s) => {
    if (s.alive !== true || !isHostedTaskKey(s.key, taskId)) return false
    if (engineAlive?.get(s.key) === false) return false
    if (s.key === `${taskId}::tab-1`) return true
    // A split leaf (`<task>::tab-2::leaf-2`) is not a tab id and matches
    // neither half, which is the rule delivery already applies.
    const tabId = s.key.slice(taskId.length + 2)
    return labelled.has(tabId) || sessionArgvNamesEngine(s.command, engineBin)
  })
}
