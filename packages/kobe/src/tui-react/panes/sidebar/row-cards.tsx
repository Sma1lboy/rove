/** @jsxImportSource @opentui/react */
/**
 * Shared per-row React hooks for the sidebar's rows: the spinner-frame
 * subscription, the `+N −M` changes hook + chip, the unread-lamp "seen"
 * bookkeeping, and the jump digit.
 *
 * Poller contract (async canon): the fire-and-forget `poll*` call lives in
 * an effect keyed on the Sidebar's `branchTick` (never in render), while
 * the cached `read` side (`worktreeChanges`) is a plain synchronous getter
 * read at render time. A finishing poll surfaces on the next tick
 * re-render (≤100ms via the spinner tick) rather than notifying: the tick
 * pulls, nothing pushes.
 */

import type { TaskEngineState } from "@/client/remote-orchestrator"
import { useEffect, useSyncExternalStore } from "react"
import { spinnerFrameSnapshot, subscribeSpinnerFrame } from "../../../tui/lib/spinner-frame-store"
import type { SidebarRow } from "../../../tui/panes/sidebar/groups"
import { taskJumpDigit } from "../../../tui/panes/sidebar/jump-digits"
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
 * rows and nothing else — a component-level interval would re-run the whole
 * Sidebar per tick. Exported for the tree's one-line worktree rows.
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
const NO_CHANGES: WorktreeChanges = { added: 0, deleted: 0 }

export function useChanges(
  sources: {
    readonly branchTick: number
    readonly worktreeChanges?: ReadonlyMap<string, WorktreeChanges | null> | null
  },
  task: SidebarRow["task"],
): WorktreeChanges | null {
  const pushed = pickPushedChanges(sources.worktreeChanges, task.worktreePath)
  const hasPushed = pushed !== null
  useEffect(() => {
    // Dependency-only invalidation key: re-poll on the sidebar's ~2s tick.
    void sources.branchTick
    if (hasPushed) return
    pollWorktreeChanges(task.worktreePath)
  }, [hasPushed, task.worktreePath, sources.branchTick])
  // A row with NO worktree yet (task created, not yet materialized) has no
  // uncommitted worktree work — that is a fact, not an unknown, so it draws no
  // chip. Only a worktree that EXISTS and could not be read reads as unknown;
  // otherwise every fresh task would wear a `?` while its job is still running,
  // which the materializing spinner already says better.
  if (!task.worktreePath) return NO_CHANGES
  // `"unknown"` = the DAEMON tracked this worktree and its git read failed;
  // `null` from the poller = the same fact on the no-daemon path. Both render
  // as the unknown mark, so they collapse here.
  if (pushed === "unknown") return null
  return pushed ?? worktreeChanges(task.worktreePath)
}

/** Cells the unknown mark occupies — one, same as any single chip glyph. */
export const UNKNOWN_CHANGES_MARK = "?"

/** Right-edge git metrics stay one non-shrinking cluster while metadata takes
 * the flexible middle column. This keeps every row scannable at the same
 * visual anchor even when a branch/title is long. Shared with the tree rows.
 *
 * `+N −M` count UNCOMMITTED files; `↑J` counts COMMITS this worktree has that
 * its base does not, and `↓K` the ones the base has that it does not. `↑J`
 * leads, in the success tone, because it is the row's own delivered work — and
 * because committing empties `+N −M`, it is the ONLY thing that separates a
 * worker that shipped from one that reported success and shipped nothing. `↓K`
 * sits last and in the warning tone because it is the only one that is not
 * about work the row did: main moves several times a day, and an attempt that
 * has been running for two hours is building against a base that no longer
 * exists. Both are absent (not zero) when no base ref resolves, so a repo with
 * no remote reads exactly as it always did.
 *
 * `↑`/`↓` are U+2191/U+2193 (Arrows) — single-width in every monospace font we
 * target, same coverage rule the `row-view.ts` glyph comments record. */
export function ChangeStats(props: { readonly changes: WorktreeChanges | null }) {
  const { theme } = useTheme()
  // `null` = the git read failed or has not landed yet. It must NOT render
  // like a clean row: hiding the cluster is what let an unreadable worktree
  // read as "nothing uncommitted here" right before the user deleted it. A
  // muted `?` says the counts are unknown — the same muted-tone vocabulary
  // `prCheckChip` already uses for a value nothing is confirming any more,
  // and `?` is free in the glyph set this cluster shares.
  if (props.changes === null) {
    return (
      <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
        {UNKNOWN_CHANGES_MARK}
      </text>
    )
  }
  const ahead = props.changes.ahead ?? 0
  const behind = props.changes.behind ?? 0
  if (props.changes.added <= 0 && props.changes.deleted <= 0 && ahead <= 0 && behind <= 0) return null
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      {ahead > 0 ? (
        <text fg={theme.success} wrapMode="none" flexShrink={0}>
          ↑{ahead}
        </text>
      ) : null}
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
      {behind > 0 ? (
        <text fg={theme.warning} wrapMode="none" flexShrink={0}>
          ↓{behind}
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
 * Process-scoped, so it is only half the record: the daemon's activity
 * registry outlives the TUI, and relaunching kobe would otherwise re-light
 * every completion already read. The durable mark in
 * `workspace/completion-seen` survives the restart; this Set is the
 * same-render answer.
 *
 * Keyed per ROW (task, or task+tab in the tree), not per task: a task owns
 * several tab rows, and they render in the same pass. A sibling tab — which
 * legitimately passes `activityState: undefined` — would take the clear
 * branch and wipe the bit the completed tab's row just recorded, flipping the
 * lamp ✓ → ● on every task switch.
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
 * Persisted half of the seen bit: read the stored mark at render
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
export function JumpDigit(props: { flatIndex: number; dim: boolean }) {
  const { theme } = useTheme()
  const digit = taskJumpDigit(props.flatIndex)
  if (digit === null) return null
  return (
    <text fg={props.dim ? theme.textMuted : theme.accent} wrapMode="none" flexShrink={0}>
      {digit}
    </text>
  )
}
