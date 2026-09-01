/**
 * Which activity entry names a sidebar TAB row's state glyph.
 *
 * Its own module along a real seam: everything in `tree-core` answers "what
 * rows exist"; this answers "which of the daemon's two activity levels speaks
 * for this row". It touches no row shapes and no tree — the whole file is one
 * generic function over the daemon's activity contract, which is why the
 * precedence rule below can be tested with two plain values.
 */

/**
 * Which activity entry names a TAB row's state glyph.
 *
 * The daemon publishes activity at two levels. Tab-level is the precise
 * answer. Task-level is a last-event-wins rollup across every tab, so it may
 * only stand in for a task whose engine reports NO tab identity at all — a
 * `claude` the user typed into a shell, which has no `KOBE_TAB_ID` to tag its
 * hook events with.
 *
 * Once ANY tab of the task has reported, the rollup means "whichever tab
 * moved last", and lending it to whichever tab happens to be active made a
 * switch inside a busy worktree light the tab you switched TO with its
 * sibling's spinner until its own state landed (owner report 2026-08-10).
 */
export function tabRowActivity<T>(args: {
  /** This tab's own entry, when the daemon has one. */
  readonly tabActivity: T | undefined
  /** How many tabs of this task have reported at all. */
  readonly reportedTabCount: number
  /** The task-level rollup. */
  readonly taskActivity: T | undefined
  /** Whether this row is the task's active tab. */
  readonly active: boolean
}): T | undefined {
  if (args.tabActivity !== undefined) return args.tabActivity
  if (!args.active || args.reportedTabCount > 0) return undefined
  return args.taskActivity
}
