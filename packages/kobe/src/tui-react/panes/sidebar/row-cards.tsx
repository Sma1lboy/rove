/** @jsxImportSource @opentui/react */
/**
 * Shared per-row React hooks for the sidebar's rows.
 *
 * History: this file used to own the flat sidebar's two-line row cards
 * (`ProjectRowCard` / `TaskRowCard`). The flat sidebar is gone from the
 * product and those cards had zero callers — the hover-tooltip feed lived
 * in them, which is exactly what made the tooltip path unreachable — so
 * the cards were removed (2026-08-30). What survives is the seam the tree
 * sidebar's one-line rows import: the spinner-frame subscription, the
 * `+N −M` changes hook + chip, the unread-lamp "seen" bookkeeping, and the
 * (retired-print) jump-digit placeholder.
 *
 * Poller contract (async canon): the fire-and-forget `poll*` call lives in
 * an effect keyed on the Sidebar's `branchTick` (never in render), while
 * the cached `read` side (`worktreeChanges`) is a plain synchronous getter
 * read at render time. A finishing poll surfaces on the next tick
 * re-render (≤100ms via the spinner tick) instead of notifying — the Solid
 * signal's push is replaced by the tick's pull.
 */

import type { TaskEngineState } from "@/client/remote-orchestrator"
import { useEffect, useSyncExternalStore } from "react"
import { spinnerFrameSnapshot, subscribeSpinnerFrame } from "../../../tui/lib/spinner-frame-store"
import type { SidebarRow } from "../../../tui/panes/sidebar/groups"
import { type WorktreeChanges, pickPushedChanges } from "../../../tui/panes/sidebar/worktree-changes"
import { pollWorktreeChanges, worktreeChanges } from "../../../tui/panes/sidebar/worktree-changes-poller"
import { useOptionalKV } from "../../context/kv"
import { useTheme } from "../../context/theme"
import { completionSeenAt, completionSeenKey, markCompletionSeen } from "../../workspace/completion-seen"

const NOOP_SUBSCRIBE = () => () => {}
const ZERO_FRAME = () => 0

/**
 * Per-row spinner pulse — subscribes to the shared 10Hz frame store ONLY
 * while this row actually animates, so a frame tick re-renders the loading
 * rows and nothing else (the old component-level interval re-ran the whole
 * Sidebar per tick). Exported for the tree's one-line worktree rows.
 */
export function useSpinnerFrame(active: boolean): number {
  return useSyncExternalStore(
    active ? subscribeSpinnerFrame : NOOP_SUBSCRIBE,
    active ? spinnerFrameSnapshot : ZERO_FRAME,
  )
}

/**
 * Per-row `+N −M` counts: daemon-pushed when available, else the local
 * poller cache (poll scheduled in an effect). The param is structural —
 * the tree's row props carry exactly the two fields it reads.
 */
export function useChanges(
  sources: { readonly branchTick: number; readonly worktreeChanges?: ReadonlyMap<string, WorktreeChanges> | null },
  task: SidebarRow["task"],
): WorktreeChanges {
  const pushed = pickPushedChanges(sources.worktreeChanges, task.worktreePath)
  const hasPushed = pushed !== null
  useEffect(() => {
    // Dependency-only invalidation key: re-poll on the sidebar's ~2s tick.
    void sources.branchTick
    if (hasPushed) return
    pollWorktreeChanges(task.worktreePath)
  }, [hasPushed, task.worktreePath, sources.branchTick])
  return pushed ?? worktreeChanges(task.worktreePath)
}

/** Right-edge git metrics stay one non-shrinking cluster while metadata takes
 * the flexible middle column. This keeps every row scannable at the same
 * visual anchor even when a branch/title is long. Shared with the tree rows. */
export function ChangeStats(props: { readonly changes: WorktreeChanges }) {
  const { theme } = useTheme()
  if (props.changes.added <= 0 && props.changes.deleted <= 0) return null
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      {props.changes.added > 0 ? (
        <text fg={theme.success} wrapMode="none" flexShrink={0}>
          +{props.changes.added}
        </text>
      ) : null}
      {props.changes.deleted > 0 ? (
        <text fg={theme.error} wrapMode="none" flexShrink={0}>
          −{props.changes.deleted}
        </text>
      ) : null}
    </box>
  )
}

/**
 * Rows whose CURRENT `turn_complete` the user has already looked at
 * (selected while complete) — the herdr "seen" bit driving ● → ✓. Cleared the
 * moment that row's activity state moves off `turn_complete`.
 *
 * Process-scoped, and that used to be the whole record: the daemon's activity
 * registry outlives the TUI, so relaunching kobe re-lit every completion you
 * had already read (issue #22). The durable mark in `workspace/completion-seen`
 * is what survives the restart; this Set stays the same-render answer.
 *
 * Keyed per ROW (task, or task+tab in the tree), not per task: a task owns
 * several tab rows, and they render in the same pass. A sibling tab — which
 * legitimately passes `activityState: undefined` — took the clear branch and
 * wiped the bit the completed tab's row had just recorded. Symptom (owner
 * report 2026-08-10): open the tab, the lamp digests to ✓, and it flips back
 * to ● the moment you leave, forever.
 */
const completionSeenIds = new Set<string>()

/**
 * Deterministic render-time seen bookkeeping (herdr ● → ✓), shared with the
 * tree's tab rows: the same render that shows a viewed+complete row must
 * already draw the digested ✓ — an unread lamp on the session you are
 * sitting IN is noise. `viewing` is "this row is what the right pane
 * shows"; the mark clears as soon as activity moves off turn_complete.
 *
 * `tabId` scopes the bit to one tab row; omit it for the flat sidebar's
 * task cards, which own the task's whole activity rollup.
 *
 * `durableSeen` is the persisted answer for the SAME completion (see
 * {@link useDurableCompletionSeen}) — ORed in rather than folded into the
 * Set, because it is computed against the current completion's timestamp and
 * therefore un-sets itself the moment a newer turn completes.
 */
export function completionSeenFor(
  taskId: string,
  activityState: string | undefined,
  viewing: boolean,
  tabId?: string,
  durableSeen = false,
): boolean {
  const key = completionSeenKey(taskId, tabId)
  if (activityState === "turn_complete") {
    if (viewing) completionSeenIds.add(key)
  } else {
    completionSeenIds.delete(key)
  }
  return completionSeenIds.has(key) || durableSeen
}

/** The stamp a row's seen mark is keyed on, or undefined when the row is not
 *  sitting on a completion at all. */
export function completionStampOf(activity: TaskEngineState | undefined): number | undefined {
  return activity?.state === "turn_complete" ? activity.at : undefined
}

/**
 * Persisted half of the seen bit (issue #22): read the stored mark at render
 * time, and record this completion while you are looking at it.
 *
 * The write is an EFFECT on purpose — `kv.set` re-renders every KV consumer,
 * so writing during render would update the provider while another component
 * renders. A row with no KV provider (render tests, panes mounted outside the
 * context) keeps the session-only behaviour.
 */
export function useDurableCompletionSeen(
  taskId: string,
  tabId: string | undefined,
  completionAt: number | undefined,
  viewing: boolean,
): boolean {
  const kv = useOptionalKV()
  const key = completionSeenKey(taskId, tabId)
  const seen = completionSeenAt(kv, key, completionAt)
  useEffect(() => {
    if (!kv || !viewing || completionAt === undefined || seen) return
    markCompletionSeen(kv, key, completionAt)
  }, [kv, key, completionAt, viewing, seen])
  return seen
}

/**
 * The `ctrl+<digit>` this row answers to, right-stuck on its title line.
 * Printing it is what makes the chord usable at all: the digits follow the
 * VISIBLE order, so under `recent` sort they re-shuffle as you switch —
 * you read the number, you don't remember it. Rows past the ninth show
 * nothing rather than a digit that jumps somewhere else. Keyed on the flat
 * index directly so the tree's rows (no SidebarRow wrapper) share it.
 */
// ponytail: ctrl+<digit> jump chord still works, just no longer printed on the row.
export function JumpDigit(_props: { flatIndex: number; dim: boolean }) {
  return null
}
