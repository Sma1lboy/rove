/**
 * Daemon-side auto-title: renames a placeholder-titled task (`(new task)`)
 * from its first usable user prompt in the engine's own on-disk transcript,
 * with no UI attached. The rename goes `orch.setTitle` → `store.update` →
 * `task.snapshot`, so attached Tasks panes update live.
 *
 * Only placeholder tasks touch disk (`deriveTitleFromSession` returns `""`
 * until a usable message exists). A per-task failure is logged and never
 * blocks the rest of the tick. The detach-time rename in `tui/direct.ts`
 * covers a `rove` running without a live daemon.
 */

import type { DaemonOrchestrator, VendorId } from "./contracts.ts"
import { logDaemonError } from "./crash-log"
import type { DaemonRuntimeAdapter } from "./runtime.ts"
import { startTicker } from "./ticker.ts"

/** Default re-scan cadence; responsive without hammering disk. */
export const DEFAULT_AUTO_TITLE_POLL_MS = 4000

/** A task's first-user-prompt title from its on-disk transcript; `""` when none yet. */
export type TitleDeriver = (worktree: string, vendor: VendorId) => Promise<string>

/** A title from ONE session's transcript, by id; `""` when none yet. */
export type SessionTitleDeriver = (vendor: VendorId, sessionId: string) => Promise<string>

/** The conversation a task's own engine tab pinned, when it pinned one. */
export type ConversationOf = (taskId: string) => { readonly vendor?: VendorId; readonly sessionId: string } | undefined

/** How a task that shares its directory finds its own conversation. */
export interface SharedDirNaming {
  readonly conversationOf: ConversationOf
  readonly deriveById: SessionTitleDeriver
}

/**
 * The session id the task's first engine tab pinned (`EngineTab.sessionId`, written by the
 * client that spawned it), with that tab's vendor. Rows are opaque to the daemon, so read
 * defensively: anything unexpected is "no pinned conversation".
 */
export function pinnedConversation(
  state: { readonly tabs: readonly { readonly kind: string; readonly [field: string]: unknown }[] } | null,
): ReturnType<ConversationOf> {
  const tab = state?.tabs.find((t) => t.kind === "engine" && typeof t.sessionId === "string" && t.sessionId)
  if (!tab) return undefined
  const vendor = typeof tab.vendor === "string" ? (tab.vendor as VendorId) : undefined
  return { sessionId: tab.sessionId as string, ...(vendor ? { vendor } : {}) }
}

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
  /** rove's `PLACEHOLDER_TASK_TITLE`, via the runtime adapter. */
  placeholderTitle: string,
  /** rove's `DEFAULT_TASK_VENDOR`, via the runtime adapter; required so no
   *  local literal can drift from it. */
  defaultVendor: VendorId,
  /** Without it, a task sharing its directory keeps its placeholder. */
  shared?: SharedDirNaming,
): Promise<AutoTitled[]> {
  const renamed: AutoTitled[] = []
  const snapshot = orch.listTasks()
  // A scratch task is stored untitled (the wire shows its path), so empty counts as unnamed.
  const unnamed = (t: { title: string; scratch?: boolean }) =>
    t.title === placeholderTitle || (t.scratch === true && !t.title)
  for (const task of snapshot) {
    if (!unnamed(task) || !task.worktreePath) continue
    try {
      // A directory scan finds whichever conversation in that directory came first, so a
      // second conversation in a shared directory would take its sibling's title. Name it
      // from its own pinned session instead, or not at all. A scratch task's directory is
      // usually home, whose first conversation is never its own.
      const ownOnly =
        task.scratch === true || snapshot.some((t) => t.id !== task.id && t.worktreePath === task.worktreePath)
      const own = ownOnly ? shared?.conversationOf(task.id) : undefined
      if (ownOnly && !own) continue
      const derived = own
        ? await (shared as SharedDirNaming).deriveById(own.vendor ?? task.vendor ?? defaultVendor, own.sessionId)
        : await derive(task.worktreePath, task.vendor ?? defaultVendor)
      if (!derived) continue
      const title = withGroupOrdinal(derived, task.id, task.groupId, snapshot)
      // Re-check the live store: a manual or detach-time rename may have
      // landed during the await.
      const current = orch.getTask(task.id)
      if (!current || !unnamed(current)) continue
      await orch.setTitle(task.id, title, { keepScratch: true })
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
  runtime: Pick<
    DaemonRuntimeAdapter,
    "deriveTitleFromSession" | "deriveTitleFromSessionId" | "placeholderTaskTitle" | "defaultTaskVendor"
  >,
  intervalMs: number = DEFAULT_AUTO_TITLE_POLL_MS,
  hasSubscribers?: () => boolean,
  conversationOf?: ConversationOf,
): ReturnType<typeof startTicker> {
  const shared = conversationOf ? { conversationOf, deriveById: runtime.deriveTitleFromSessionId } : undefined
  return startTicker({
    name: "auto-title-poller",
    tickMs: intervalMs,
    ...(hasSubscribers ? { gate: hasSubscribers } : {}),
    run: () =>
      runAutoTitlePass(
        orch,
        runtime.deriveTitleFromSession,
        runtime.placeholderTaskTitle,
        runtime.defaultTaskVendor,
        shared,
      ),
  })
}
