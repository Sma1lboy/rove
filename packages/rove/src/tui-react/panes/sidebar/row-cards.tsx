/** @jsxImportSource @opentui/react */
/**
 * Shared per-row hooks for the sidebar's rows.
 *
 * Poller contract (async canon): `poll*` fires from the shared poll clock
 * (`usePollOnClock`), never in render; the cached read is a synchronous getter
 * at render time. A poll that lands a CHANGED value bumps the Sidebar's
 * `branchTick`, which re-renders the rows; an unchanged one renders nothing.
 */

import type { TaskEngineState } from "@/client/remote-orchestrator"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { sidebarPollClockSnapshot, subscribeSidebarPollClock } from "../../../tui/lib/sidebar-poll-clock"
import { spinnerFrameSnapshot, subscribeSpinnerFrame } from "../../../tui/lib/spinner-frame-store"
import type { SidebarRow } from "../../../tui/panes/sidebar/groups"
import { DONE_PULSE_MS } from "../../../tui/panes/sidebar/row-view"
import { type WorktreeChanges, pickPushedChanges } from "../../../tui/panes/sidebar/worktree-changes"
import { pollWorktreeChanges, worktreeChanges } from "../../../tui/panes/sidebar/worktree-changes-poller"
import { useDiffInks } from "../../context/diff-inks"
import { useTheme } from "../../context/theme"

const NOOP_SUBSCRIBE = () => () => {}
const ZERO_FRAME = () => 0

/** Subscribes to the shared spinner frame store ONLY while this row animates,
 *  so a tick re-renders the loading rows, not the whole Sidebar. */
export function useSpinnerFrame(active: boolean): number {
  return useSyncExternalStore(
    active ? subscribeSpinnerFrame : NOOP_SUBSCRIBE,
    active ? spinnerFrameSnapshot : ZERO_FRAME,
  )
}

/** Polls `key` now and on every poll-clock tick, without re-rendering. */
export function usePollOnClock(key: string | null | undefined, poll: (key: string) => void): void {
  useEffect(() => {
    if (!key) return
    poll(key)
    return subscribeSidebarPollClock(() => poll(key))
  }, [key, poll])
}

/** Re-renders this row on each poll-clock tick ONLY while `active`: for output read off `Date.now()`. */
export function useClockTick(active: boolean): number {
  return useSyncExternalStore(
    active ? subscribeSidebarPollClock : NOOP_SUBSCRIBE,
    active ? sidebarPollClockSnapshot : ZERO_FRAME,
  )
}

/** Per-row `+N −M` counts: daemon-pushed when available, else the local poller cache. */
const NO_CHANGES: WorktreeChanges = { added: 0, deleted: 0 }

export function useChanges(
  sources: {
    readonly worktreeChanges?: ReadonlyMap<string, WorktreeChanges | null> | null
  },
  task: SidebarRow["task"],
): WorktreeChanges | null {
  const pushed = pickPushedChanges(sources.worktreeChanges, task.worktreePath)
  const hasPushed = pushed !== null
  usePollOnClock(hasPushed ? null : task.worktreePath, pollWorktreeChanges)
  // No worktree yet = no uncommitted work (a fact, not unknown): no chip. Only
  // an existing worktree that can't be read is unknown.
  if (!task.worktreePath) return NO_CHANGES
  // `"unknown"` (daemon) and poller `null` both mean the git read failed.
  if (pushed === "unknown") return null
  return pushed ?? worktreeChanges(task.worktreePath)
}

/** Cells the unknown mark occupies — one, same as any single chip glyph. */
export const UNKNOWN_CHANGES_MARK = "?"

/** Right-edge git metrics: one non-shrinking cluster.
 *
 * `+N −M` count UNCOMMITTED files; `↑J` commits ahead of base, `↓K` behind.
 * `↑J` leads in the success tone: committing empties `+N −M`, so it is the
 * only thing that tells a worker that shipped from one that shipped nothing.
 * `↓K` is last, warning tone: the base moved under the attempt. Both are
 * absent (not zero) when no base ref resolves.
 *
 * `↑`/`↓` (U+2191/U+2193) are single-width in every targeted monospace font. */
export function ChangeStats(props: { readonly changes: WorktreeChanges | null }) {
  const { theme } = useTheme()
  const inks = useDiffInks()
  // `null` = read failed or pending. Must NOT render like a clean row, or an
  // unreadable worktree reads as "nothing uncommitted" before a delete.
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
        <text fg={inks.added} wrapMode="none" flexShrink={0}>
          +{props.changes.added}
        </text>
      ) : null}
      {props.changes.deleted > 0 ? (
        <text fg={inks.removed} wrapMode="none" flexShrink={0}>
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

/** The completion stamp the landing pulse keys on, or undefined when the row
 *  is not sitting on a completion at all. */
export function completionStampOf(activity: TaskEngineState | undefined): number | undefined {
  return activity?.state === "turn_complete" ? activity.at : undefined
}

/**
 * True for {@link DONE_PULSE_MS} after a NEW completion: the sidebar's landing
 * cue (the tab strip, which also flashes, is hidden by default).
 *
 * Edge-triggered on the completion STAMP, not the state (`turn_complete`
 * lingers until read). The ref seeds from the first stamp, so a first mount
 * or a row scrolled back into view does not fire.
 */
export function useDonePulse(completionAt: number | undefined): boolean {
  const [pulsingAt, setPulsingAt] = useState<number | null>(null)
  const seenRef = useRef<number | undefined>(undefined)
  const seeded = useRef(false)
  useEffect(() => {
    const previous = seenRef.current
    seenRef.current = completionAt
    if (!seeded.current) {
      seeded.current = true
      return
    }
    if (completionAt === undefined || completionAt === previous) return
    setPulsingAt(completionAt)
    const timer = setTimeout(() => setPulsingAt(null), DONE_PULSE_MS)
    return () => clearTimeout(timer)
  }, [completionAt])
  return pulsingAt !== null && pulsingAt === completionAt
}
