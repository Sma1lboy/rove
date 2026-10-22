import { type RowTone, rowStatusGlyph } from "@/lib/row-status-glyph"
import { t } from "@/tui/i18n"
import { breathGlyph } from "@/tui/lib/breathe"
import { DEFAULT_GLYPHS, type GlyphSet } from "@/tui/lib/glyphs"
import type { Task } from "@/types/task"
import { isBuiltinVendor } from "@/types/vendor"
import type { RowStatus } from "@sma1lboy/rove-daemon/daemon/row-status"
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

/**
 * `rowStatusGlyph`'s tones in the TUI palette. Amber for a wait you can clear
 * (a rate limit, a question), red for what stays broken until you act: the
 * split the web rail and the Inbox draw too.
 */
const TONES: Readonly<Record<RowTone, SidebarTone>> = {
  accent: "primary",
  warning: "warning",
  error: "error",
  muted: "textMuted",
}

export function sidebarTone(tone: RowTone): SidebarTone {
  return TONES[tone]
}

export const SPINNER_FRAME_MS = 80

/** Shared tick cycle: a multiple of `BREATH_TICKS`, so the breath wraps without a jump. */
export const SPINNER_TICK_CYCLE = 600

/** Post-turn emphasis; shared by the tab strip and sidebar tab rows so one landing reads as one event. */
export const DONE_PULSE_MS = 600

/*
 * The rail's states (braille glyphs; the preset is `GlyphSet`), all decided by
 * the daemon (`rove-daemon/src/daemon/row-status.ts`) and drawn through
 * `rowStatusGlyph`; `?` and `!` ask the reader to act:
 *
 *   spinner  working: an engine turn, or a task-level job or deletion
 *   `?`      blocked on your answer (permission prompt or question dialog)
 *   `!`      needs you (rate limit, error, dead engine, restored session,
 *            failed deletion)
 *   `●`      a turn finished and nobody has looked
 *   `○`      quiet (idle, unobserved, shell tab, untracked custom engine)
 *
 * `!` and `○` are one cell in every monospace font; `◌` (U+25CC, oversized
 * fallback) and `✕` (U+2715, dingbat block) are not.
 */

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

/**
 * Sole source of the row `loading` decision (`buildSidebarRowView` calls it),
 * so a spin check built on it can't drift from what rows render: a drift
 * would freeze a genuinely-loading row's spinner.
 */
export function rowIsLoading(status: RowStatus | undefined): boolean {
  return rowStatusGlyph(status, DEFAULT_GLYPHS).spinning
}

/**
 * OR of `rowIsLoading` over a task list. No production caller: the spinner
 * interval runs on `spinner-frame-store` subscriber count; only its
 * agreement test uses this.
 */
export function anyRowLoading(tasks: readonly Task[], status: (taskId: string) => RowStatus | undefined): boolean {
  return tasks.some((task) => rowIsLoading(status(task.id)))
}

export function buildSidebarRowView(opts: {
  readonly task: Task
  /**
   * The daemon's status for this row (`row.status`): the task rollup, or one
   * tab's. Absent = the daemon reported nothing, which reads as quiet.
   */
  readonly status?: RowStatus
  /** Transient lifecycle marks (`engine.lifecycle` channel): a `◇N`
   *  subagent prefix ahead of the branch. */
  readonly lifecycle?: { readonly subagents: number }
  readonly spinnerFrame: number
  readonly subtitleBudget: number
  readonly truncateBranch: (branch: string, budget: number) => string
  /** Checked-out branch of a `main` row's repo root (its `task.branch` is always `""`). */
  readonly mainBranch?: string
  /** The glyph preset; braille when absent. */
  readonly glyphs?: GlyphSet
}): SidebarRowView {
  const { task, status } = opts
  const isMain = task.kind === "main"
  const branch = isMain ? (opts.mainBranch ?? "") : task.branch
  const glyphs = opts.glyphs ?? DEFAULT_GLYPHS
  const mark = rowStatusGlyph(status, glyphs)
  // A custom engine nobody reports on is untracked, not idle: the subtitle
  // says so, or the row would read as stuck.
  const untrackedCustomEngine = isCustomEngineTask(task) && status?.state === undefined && !mark.spinning
  // A daemon job (worktree add) is the rollup's `busy`.
  const materializing = status?.kind === "busy" && status.reason === "job"
  // The deletion WORD is a task fact (the subtitle); its glyph is the daemon's.
  const deleting = task.deletion?.phase === "queued" || task.deletion?.phase === "running"
  const deleteFailed = task.deletion?.phase === "error"
  const loading = mark.spinning
  const spinnerFrames = glyphs.spinner
  // The breath, not a flat frame index: every spinner in the TUI inhales on the shared tick.
  const stateGlyph = loading ? breathGlyph(spinnerFrames, opts.spinnerFrame) : mark.glyph
  // Subtitle priority: deletion/materializing word, branch, "no tracking",
  // dash. Activity is carried by the glyph, not here; task lifecycle belongs
  // to the board.
  const fallbackSubtitle = untrackedCustomEngine ? noTrackingSubtitle() : "—"
  // `◇N` subagent prefix only while spinning, so a mark whose end event never
  // arrived can't caption a quiet row. No compaction word: its end event is
  // cancellable (esc during /compact), so it has no reliable clearing edge.
  const subagents = loading ? (opts.lifecycle?.subagents ?? 0) : 0
  const branchWithMarks = subagents > 0 && branch.length > 0 ? `${glyphs.subagent}${subagents} ${branch}` : branch
  const subtitleText =
    deleting || deleteFailed
      ? opts.truncateBranch(deletionSubtitle(deleteFailed), opts.subtitleBudget)
      : materializing
        ? opts.truncateBranch(materializingSubtitle(), opts.subtitleBudget)
        : branchWithMarks.length > 0
          ? opts.truncateBranch(branchWithMarks, opts.subtitleBudget)
          : opts.truncateBranch(fallbackSubtitle, opts.subtitleBudget)
  return {
    isMain,
    titleText: isMain ? repoBasename(task.repo) : task.title,
    subtitleText,
    loading,
    stateGlyph,
    tone: sidebarTone(mark.tone),
    spinnerFrames,
    materializing,
  }
}

/**
 * Overlay the live frame onto a view built with `spinnerFrame: 0`. `frame` is
 * an accessor read only when loading, so inside a memo the spinner tick is a
 * conditional dependency and idle rows never re-derive. Output equals
 * `buildSidebarRowView` with the live frame.
 */
export function withSpinnerFrame(view: SidebarRowView, frame: () => number): SidebarRowView {
  if (!view.loading) return view
  const frames = view.spinnerFrames
  const spinner = breathGlyph(frames, frame())
  if (spinner === view.stateGlyph) return view
  return { ...view, stateGlyph: spinner }
}
