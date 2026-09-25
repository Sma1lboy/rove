import type { TaskEngineState, TaskJobState } from "@/client/remote-orchestrator"
import type { TaskActivityState } from "@/engine/hook-events"
import { DEFAULT_SPINNER_FRAMES } from "@/engine/spinner-frames"
import { t } from "@/tui/i18n"
import type { Task } from "@/types/task"
import { isBuiltinVendor } from "@/types/vendor"
import { repoBasename } from "./groups"

export type SidebarTone = "success" | "warning" | "primary" | "textMuted" | "error"

export interface SidebarRowView {
  readonly isMain: boolean
  readonly titleText: string
  readonly subtitleText: string
  readonly loading: boolean
  /** Status glyph; one vocabulary for project and task rows (a project-only glyph reads as a different kind of thing). */
  readonly stateGlyph: string
  readonly tone: SidebarTone
  /** Frames this row animates while loading; carried so `withSpinnerFrame` needs no caller wiring. */
  readonly spinnerFrames: readonly string[]
  /** A daemon job (worktree add) is materialising the task: subtitle shows the sweep bar, not the shimmer. */
  readonly materializing: boolean
}

/** Attention tone; beats `loading`'s `primary` so a spinning row that needs a human stays coloured. */
function activityToneFor(state: TaskActivityState | undefined): SidebarTone | null {
  if (!ATTENTION_STATES.has(state)) return null
  // Amber for a quota wall or a waiting prompt, red for states that stay
  // broken until you act — same split as `tab-strip.tsx` `turnColor` and the
  // Inbox `itemColor`, so one tab reads the same colour everywhere.
  return state === "rate_limited" || state === "permission_needed" ? "warning" : "error"
}

/** Alias of the default frames for existing consumers/tests. */
export const IN_PROGRESS_SPINNER: readonly string[] = DEFAULT_SPINNER_FRAMES

export const SPINNER_FRAME_MS = 100

/**
 * Shared 10Hz counter cycle: a common multiple of every frame-set length
 * (8/10/12/15/20/24/25), so each row's `% frames.length` loops seamlessly.
 */
export const SPINNER_TICK_CYCLE = 600

/** Post-turn emphasis; shared by the tab strip and sidebar tab rows so one landing reads as one event. */
export const DONE_PULSE_MS = 600

/**
 * The rail's states; `?` and `!` ask the reader to act:
 *
 *   spinner  working
 *   `?`      blocked on your answer (permission prompt or question dialog),
 *            the same glyph the tab strip and Inbox use for it
 *   `!`      needs you (rate limit, error, dead engine, failed deletion)
 *   `●`      a turn finished and you have not looked
 *   `○`      quiet (idle, unobserved, shell tab, untracked custom engine)
 *
 * `!` and `○` are one cell in every monospace font; `◌` (U+25CC, oversized
 * fallback) and `✕` (U+2715, dingbat block) are not.
 */
export const NO_STATE_GLYPH = "○"
export const ATTENTION_GLYPH = "!"
export const AWAITING_INPUT_GLYPH = "?"

const ATTENTION_STATES: ReadonlySet<TaskActivityState | undefined> = new Set([
  "rate_limited",
  "permission_needed",
  "error",
  "dead",
])

/** Whether the rail marks this `?`/`!` (stopped until somebody acts); lets renderers skip re-listing the states. */
export function isAttentionActivity(state: TaskActivityState | undefined): boolean {
  return ATTENTION_STATES.has(state)
}

// The `attention` comparator lives in `task-group-view.ts`: it ranks by the
// derived task group, whose glyphs are defined from the constants here, so
// the import must run that way.

/** Called at render time so `t()` is reactive. */
function noTrackingSubtitle(): string {
  return t("tasks.subtitle.noTracking")
}

/**
 * Replaces the branch while `ensureWorktree` runs (minutes on a huge repo):
 * no branch exists on disk yet. Called at render time so `t()` is reactive.
 */
function materializingSubtitle(): string {
  return t("tasks.subtitle.materializing")
}

function deletionSubtitle(failed: boolean): string {
  return failed ? t("tasks.subtitle.deleteFailed") : t("tasks.subtitle.deleting")
}

/**
 * Custom engines have no transcript for the activity monitor, so liveness
 * isn't tracked. `undefined` vendor means the built-in default
 * ({@link DEFAULT_TASK_VENDOR}), not custom; `main` rows have no session.
 */
function isCustomEngineTask(task: Task): boolean {
  if (task.kind === "main") return false
  return task.vendor !== undefined && !isBuiltinVendor(task.vendor)
}

/** The loading subset of `buildSidebarRowView`'s options. */
export interface RowLoadingInputs {
  readonly task: Task
  readonly activity?: TaskEngineState
  readonly job?: TaskJobState
}

/**
 * Sole source of the row `loading` decision (`buildSidebarRowView` calls it),
 * so a spin check built on it can't drift from what rows render — a drift
 * would freeze a genuinely-loading row's spinner.
 */
export function rowIsLoading(opts: RowLoadingInputs): boolean {
  const { task } = opts
  const activityState = opts.activity?.state
  const hasActivity = activityState !== undefined
  const untrackedCustomEngine = isCustomEngineTask(task) && !hasActivity
  const materializing = opts.job !== undefined
  const deleting = task.deletion?.phase === "queued" || task.deletion?.phase === "running"
  const working = activityState === "running"
  return deleting || materializing || (!untrackedCustomEngine && working)
}

/**
 * OR of `rowIsLoading` over a task list. No production caller: the spinner
 * interval runs on `spinner-frame-store` subscriber count; only its
 * agreement test uses this.
 */
export function anyRowLoading(
  tasks: readonly Task[],
  reads: {
    activity(taskId: string): TaskEngineState | undefined
    job(taskId: string): TaskJobState | undefined
  },
): boolean {
  return tasks.some((task) =>
    rowIsLoading({
      task,
      activity: reads.activity(task.id),
      job: reads.job(task.id),
    }),
  )
}

export function buildSidebarRowView(opts: {
  readonly task: Task
  readonly activity?: TaskEngineState
  /** Transient lifecycle marks (`engine.lifecycle` channel): a `◇N`
   *  subagent prefix ahead of the branch. */
  readonly lifecycle?: { readonly subagents: number }
  /**
   * In-flight daemon job from `task.jobs` (e.g. `ensureWorktree`); presence
   * means running, in every attached pane. Outranks other signals: the
   * worktree doesn't exist yet.
   */
  readonly job?: TaskJobState
  readonly spinnerFrame: number
  readonly subtitleBudget: number
  readonly truncateBranch: (branch: string, budget: number) => string
  /** Checked-out branch of a `main` row's repo root (its `task.branch` is always `""`). */
  readonly mainBranch?: string
  /**
   * Selected since the current `turn_complete` fired; the `●` badge then
   * drops back to quiet. Callers track it; absent means unseen.
   */
  readonly completionSeen?: boolean
}): SidebarRowView {
  const { task } = opts
  const isMain = task.kind === "main"
  const branch = isMain ? (opts.mainBranch ?? "") : task.branch
  const activityState = opts.activity?.state
  const hasActivity = activityState !== undefined
  const activityBadge = activityBadgeFor(activityState, opts.completionSeen === true)
  const activityTone = activityToneFor(activityState)
  // No activity for a custom engine means untracked, not idle: a spinner
  // would lie. Hook-driven states are engine-agnostic, so any that fired
  // still count.
  const untrackedCustomEngine = isCustomEngineTask(task) && !hasActivity
  // A daemon job outranks even that fallback: it's a daemon-side fact, not
  // engine telemetry.
  const materializing = opts.job !== undefined
  const deleting = task.deletion?.phase === "queued" || task.deletion?.phase === "running"
  const deleteFailed = task.deletion?.phase === "error"
  const loading = rowIsLoading({
    task,
    activity: opts.activity,
    job: opts.job,
  })
  // Frames must not reuse a badge glyph (`●`, `○`), or a running row reads as finished.
  const spinnerFrames = DEFAULT_SPINNER_FRAMES
  const spinner = spinnerFrames[opts.spinnerFrame % spinnerFrames.length] ?? spinnerFrames[0]
  const tone = deleteFailed
    ? "error"
    : deleting || materializing
      ? "primary"
      : untrackedCustomEngine
        ? "textMuted"
        : (activityTone ?? (loading ? "primary" : (activityBadge?.tone ?? "textMuted")))
  // Subtitle priority: deletion/materializing word, branch, "no tracking"
  // (untracked custom engine, so it doesn't read as stuck), dash. Activity
  // is carried by the glyph, not here; task lifecycle belongs to the board.
  const fallbackSubtitle = untrackedCustomEngine ? noTrackingSubtitle() : "—"
  // `◇N` subagent prefix only while spinning, so a mark whose end event never
  // arrived can't caption a quiet row. No compaction word: its end event is
  // cancellable (esc during /compact), so it has no reliable clearing edge.
  const subagents = loading ? (opts.lifecycle?.subagents ?? 0) : 0
  const branchWithMarks = subagents > 0 && branch.length > 0 ? `◇${subagents} ${branch}` : branch
  const subtitleText =
    deleting || deleteFailed
      ? opts.truncateBranch(deletionSubtitle(deleteFailed), opts.subtitleBudget)
      : materializing
        ? opts.truncateBranch(materializingSubtitle(), opts.subtitleBudget)
        : branchWithMarks.length > 0
          ? opts.truncateBranch(branchWithMarks, opts.subtitleBudget)
          : opts.truncateBranch(fallbackSubtitle, opts.subtitleBudget)
  // The client drops `idle` entries, so absence means quiet.
  const restGlyph = deleteFailed ? ATTENTION_GLYPH : (activityBadge?.glyph ?? NO_STATE_GLYPH)
  return {
    isMain,
    titleText: isMain ? repoBasename(task.repo) : task.title,
    subtitleText,
    loading,
    stateGlyph: loading ? spinner : restGlyph,
    tone,
    spinnerFrames,
    materializing,
  }
}

/**
 * Overlay the live frame onto a view built with `spinnerFrame: 0`. `frame` is
 * an accessor read only when loading, so inside a memo the 10Hz tick is a
 * conditional dependency and idle rows never re-derive. Output equals
 * `buildSidebarRowView` with the live frame.
 */
export function withSpinnerFrame(view: SidebarRowView, frame: () => number): SidebarRowView {
  if (!view.loading) return view
  const frames = view.spinnerFrames
  const spinner = frames[frame() % frames.length] ?? frames[0] ?? "⠋"
  if (spinner === view.stateGlyph) return view
  return { ...view, stateGlyph: spinner }
}

/**
 * `?` blocked on an answer, `!` needs a human, `●` unseen completion, null quiet. A seen completion is
 * consumed: back to quiet, no lingering ✓. Tone comes from
 * {@link activityToneFor} so the attention test has one copy.
 */
function activityBadgeFor(
  state: TaskActivityState | undefined,
  completionSeen: boolean,
): { glyph: string; tone: SidebarTone } | null {
  const attention = activityToneFor(state)
  if (attention !== null)
    return { glyph: state === "permission_needed" ? AWAITING_INPUT_GLYPH : ATTENTION_GLYPH, tone: attention }
  if (state === "turn_complete" && !completionSeen) return { glyph: "●", tone: "primary" }
  return null
}
