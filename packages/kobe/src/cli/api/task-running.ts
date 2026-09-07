/**
 * The `.running` rule — is ANY of a task's engine tabs actually working.
 *
 * The seam against `tab-snapshot.ts`: that file joins a persisted tab snapshot
 * against live sessions to produce ROWS. This is the single boolean built on
 * top of the same inputs, and it is the one `get-task`/`collect` publish and
 * that unattended loops act on, so it gets to be read on its own.
 */

import { isHostedTaskKey, sessionArgvNamesEngine } from "../../engine/hosted-session.ts"
import type { TabsState } from "../../tui/workspace/terminal-tabs-core.ts"
import type { TaskSessionRow } from "./tab-snapshot.ts"

/**
 * A task is RUNNING when ANY of its engine tabs has a live hosted session
 * WITH AN ENGINE IN IT — not just the canonical first one, and not merely a
 * live PTY. The old `tab-1`-only rule reported `running:false` while later
 * engine tabs (`send --tab new`, a TUI tab opened after tab-1 closed) were
 * happily alive. The `tab-1` key stays as a snapshot-free floor: it is
 * always an engine tab by construction (`initialTabs`), so it counts even
 * when the snapshot write failed. Non-engine tabs (command/content) never
 * count — same rule delivery uses.
 *
 * Which tabs those ARE is decided from the LIVE sessions, not from the
 * snapshot alone. `kind: "engine"` is a persisted display label, and a live
 * session the snapshot lost (the `unregistered` rows `joinTaskTabs` renders
 * right beside this) carries no label at all — so a task whose only engine
 * was unregistered read `running: false` while `send` delivered to it
 * happily. {@link sessionArgvNamesEngine} is the other half, and it is the
 * SAME judgement `findHostedEngineKey` uses to pick that delivery target.
 * The label stays in the union because it is the only thing that recognises
 * a custom engine whose wrapper script names no known binary.
 *
 * `engineAlive` is the process half. Session liveness alone answered `true`
 * for a task whose engine had been reaped hours earlier, because keepAlive
 * keeps the PTY. A tab nothing could walk (`null`) still counts as running:
 * "couldn't look" must never read as stopped.
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
