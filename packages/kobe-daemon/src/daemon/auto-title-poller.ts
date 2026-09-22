/**
 * Daemon-side auto-title: renames a placeholder-titled task (`(new task)`)
 * from its first usable user prompt in the engine's own on-disk transcript,
 * with no UI attached. The rename goes `orch.setTitle` → `store.update` →
 * `task.snapshot`, so attached Tasks panes update live.
 *
 * Only placeholder tasks touch disk (`deriveTitleFromSession` returns `""`
 * until a usable message exists). A per-task failure is logged and never
 * blocks the rest of the tick. The detach-time rename in `tui/direct.ts`
 * covers a `kobe` running without a live daemon.
 */

import type { DaemonOrchestrator, VendorId } from "./contracts.ts"
import { logDaemonError } from "./crash-log"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { startTicker } from "./ticker.ts"

/** Default re-scan cadence; responsive without hammering disk. */
export const DEFAULT_AUTO_TITLE_POLL_MS = 4000

/** A task's first-user-prompt title from its on-disk transcript; `""` when none yet. */
export type TitleDeriver = (worktree: string, vendor: VendorId) => Promise<string>

/** A task that this pass renamed, plus the title it was given. */
export interface AutoTitled {
  readonly id: string
  readonly title: string
}

/**
 * Rename every placeholder task that now has a usable title. Sequential
 * (gentle on disk), best-effort per task, no terminal IO. Returns the renamed
 * tasks.
 */
export async function runAutoTitlePass(
  orch: DaemonOrchestrator,
  derive: TitleDeriver,
  /** kobe's `PLACEHOLDER_TASK_TITLE`, via the runtime adapter. */
  placeholderTitle: string,
  /** kobe's `DEFAULT_TASK_VENDOR`, via the runtime adapter; required so no
   *  local literal can drift from it. */
  defaultVendor: VendorId,
): Promise<AutoTitled[]> {
  const renamed: AutoTitled[] = []
  const snapshot = orch.listTasks()
  for (const task of snapshot) {
    if (task.title !== placeholderTitle || !task.worktreePath) continue
    try {
      const derived = await derive(task.worktreePath, task.vendor ?? defaultVendor)
      if (!derived) continue
      const title = withGroupOrdinal(derived, task.id, task.groupId, snapshot)
      // Re-check the live store: a manual or detach-time rename may have
      // landed during the await.
      const current = orch.getTask(task.id)
      if (!current || current.title !== placeholderTitle) continue
      await orch.setTitle(task.id, title)
      renamed.push({ id: task.id, title })
    } catch (err) {
      logDaemonError("auto-title-poller", err)
    }
  }
  return renamed
}

/** Fan-out siblings share a first prompt, so suffix `#i/N` (creation order =
 *  tasks.json array order). Tasks without a groupId pass through. */
function withGroupOrdinal(
  title: string,
  taskId: string,
  groupId: string | undefined,
  snapshot: readonly { id: string; groupId?: string }[],
): string {
  if (!groupId) return title
  const siblings = snapshot.filter((t) => t.groupId === groupId)
  if (siblings.length < 2) return title
  const ordinal = siblings.findIndex((t) => t.id === taskId)
  if (ordinal < 0) return title
  return `${title} #${ordinal + 1}/${siblings.length}`
}

/**
 * Start the poller; `intervalMs <= 0` disables it (no-op stop).
 *
 * `hasSubscribers` gates each tick: while false the tick is a no-op, so no
 * transcript reads publish to nobody; the interval keeps running. Omit to
 * scan unconditionally (tests).
 */
export function startAutoTitlePoller(
  orch: DaemonOrchestrator,
  runtime: Pick<DaemonRuntimeAdapter, "deriveTitleFromSession" | "placeholderTaskTitle" | "defaultTaskVendor">,
  intervalMs: number = DEFAULT_AUTO_TITLE_POLL_MS,
  hasSubscribers?: () => boolean,
): ReturnType<typeof startTicker> {
  return startTicker({
    name: "auto-title-poller",
    tickMs: intervalMs,
    ...(hasSubscribers ? { gate: hasSubscribers } : {}),
    run: () =>
      runAutoTitlePass(orch, runtime.deriveTitleFromSession, runtime.placeholderTaskTitle, runtime.defaultTaskVendor),
  })
}
