/** @jsxImportSource @opentui/react */
/**
 * The sidebar's COLLAPSED rail — the task list folded down to a strip a few
 * cells wide, so the workspace gets the width back without losing the "what
 * is happening on my other tasks" glance the full rail exists for.
 *
 * Every style below renders the SAME row vocabulary the expanded rail does:
 * the status glyph and tone come from `buildSidebarRowView`, which is
 * engine-owned, so a collapsed row can never disagree with the card it folds
 * from. What varies between styles is only how much of that vocabulary
 * survives the fold.
 *
 * WHICH tasks are here, and which section each sits in, is not this file's
 * question: the rail renders the `SidebarGroup[]` the expanded tree renders,
 * so a project the tree hides cannot be a divider in the fold. See
 * `tui/panes/sidebar/project-groups.ts`.
 *
 * `digits` is the default (owner call): the jump key is the one thing a folded
 * row can still be acted on, and tinting it with the row's own state colour
 * makes the same character carry both. The rest stay as a preference.
 */

import type { TaskEngineState, TaskJobState } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { type RGBA, TextAttributes } from "@opentui/core"
import { Fragment, useMemo } from "react"
import { displayWidth } from "../../../lib/display-width"
import { taskJumpDigit } from "../../../tui/panes/sidebar/jump-digits"
import type { SidebarGroup } from "../../../tui/panes/sidebar/project-groups"
import { buildSidebarRowView, withSpinnerFrame } from "../../../tui/panes/sidebar/row-view"
import { toneColor } from "../../../tui/panes/sidebar/view-core"
import { useTheme } from "../../context/theme"
import { resolveRowSelectionChrome } from "../../ui/row-selection-chrome"
import { CollapseButton } from "./collapse-button"
import { useSpinnerFrame } from "./row-cards"

/** The styles on offer. `digits` is the default; the others are a preference. */
export type CollapsedRailStyle = "hairline" | "digits" | "glyphs" | "initials"

/** What a user who has never opened the setting gets. */
export const DEFAULT_COLLAPSED_RAIL_STYLE: CollapsedRailStyle = "digits"

/** Cycle order for the setting — widest-keeping last, so repeated presses walk
 *  from "only a colour" toward "still readable". */
export const COLLAPSED_RAIL_STYLES: readonly CollapsedRailStyle[] = ["digits", "glyphs", "initials", "hairline"]

/** Rail width in cells per style — the whole point of the fold, so it lives
 *  beside the styles rather than at a call site that would drift from them. */
export const COLLAPSED_RAIL_WIDTH: Record<CollapsedRailStyle, number> = {
  hairline: 2,
  digits: 3,
  glyphs: 4,
  initials: 7,
}

/** Two cells that stand for a title: initials across words, else its first two
 *  characters. Pure so the rule is testable without a terminal. */
export function railInitials(title: string): string {
  const words = title
    .trim()
    .split(/[\s_\-/.]+/)
    .filter(Boolean)
  if (words.length === 0) return "··"
  if (words.length === 1) return (words[0] as string).slice(0, 2).padEnd(2, " ")
  return `${(words[0] as string)[0] ?? ""}${(words[1] as string)[0] ?? ""}`
}

interface RailRow {
  readonly task: Task
  readonly glyph: string
  readonly tone: Parameters<typeof toneColor>[1]
  readonly digit: string | null
  readonly selected: boolean
}

/** One divider plus the rows under it — a project, or the scratch bench. */
interface RailSection {
  readonly key: string
  readonly label: string
  readonly rows: readonly RailRow[]
}

function useRailSections(props: {
  groups: readonly SidebarGroup[]
  selectedId: string | null
  engineState?: ReadonlyMap<string, TaskEngineState>
  taskJobs?: ReadonlyMap<string, TaskJobState>
}): readonly RailSection[] {
  const tasks = useMemo(() => props.groups.flatMap((group) => group.tasks), [props.groups])
  // One spinner clock for the whole rail: a per-row hook would give each row
  // its own phase and the strip would shimmer instead of pulse together.
  const spinning = tasks.some((task) => props.taskJobs?.get(task.id) !== undefined)
  const frame = useSpinnerFrame(spinning)
  // The jump digit is a position in the WHOLE strip, not within a section, so
  // it runs across the dividers — the same way the expanded tree numbers rows
  // down the pane rather than restarting under each project header.
  let slot = 0
  return props.groups.map((group) => ({
    key: group.key,
    label: group.label,
    rows: group.tasks.map((task) => {
      const base = buildSidebarRowView({
        task,
        activity: props.engineState?.get(task.id),
        job: props.taskJobs?.get(task.id),
        spinnerFrame: frame,
        subtitleBudget: 0,
        truncateBranch: (branch) => branch,
      })
      const view = withSpinnerFrame(base, () => frame)
      return {
        task,
        glyph: view.stateGlyph,
        tone: view.tone,
        digit: taskJumpDigit(slot++),
        selected: task.id === props.selectedId,
      }
    }),
  }))
}

export interface CollapsedRailProps {
  readonly style: CollapsedRailStyle
  /** The sections to fold — the very ones the expanded tree renders. */
  readonly groups: readonly SidebarGroup[]
  readonly selectedId: string | null
  readonly engineState?: ReadonlyMap<string, TaskEngineState>
  readonly taskJobs?: ReadonlyMap<string, TaskJobState>
  readonly onSelect: (taskId: string) => void
  /** Put the full rail back. */
  readonly onExpand: () => void
}

/** A section divider: one character of the header the expanded tree prints,
 *  then a rule. Taking it from the group's LABEL rather than the repo basename
 *  is what makes two same-named repos fold to different letters — the label is
 *  already disambiguated (`work/api` vs `oss/api`), the basename is not. */
function projectHeading(label: string, width: number): string {
  const first = new Intl.Segmenter().segment(label.trim()).containing(0)?.segment ?? "·"
  const initial = first.toLowerCase()
  const cells = displayWidth(initial)
  const head = cells > 0 && cells <= width ? initial : "·"
  return head + "─".repeat(width - displayWidth(head))
}

export function CollapsedRail(props: CollapsedRailProps) {
  const { theme } = useTheme()
  const sections = useRailSections(props)
  const width = COLLAPSED_RAIL_WIDTH[props.style]
  return (
    <box width={width} flexShrink={0} flexDirection="column" backgroundColor={theme.backgroundPanel}>
      {sections.map((section) => (
        <Fragment key={section.key}>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>
            {projectHeading(section.label, width)}
          </text>
          {section.rows.map((row) => (
            <RailRowView key={row.task.id} row={row} style={props.style} onSelect={props.onSelect} />
          ))}
        </Fragment>
      ))}
      <CollapseButton collapsed onToggle={props.onExpand} />
    </box>
  )
}

function RailRowView(props: { row: RailRow; style: CollapsedRailStyle; onSelect: (taskId: string) => void }) {
  const { theme } = useTheme()
  const { row } = props
  const fg = toneColor(theme, row.tone)
  // Selection carries the SAME `▌` the expanded rows use, resolved by the same
  // function, so the two surfaces agree about what "you are here" looks like.
  // A background alone was the whole signal before, and under a transparent
  // theme `resolveRowSelectionChrome` returns no background at all — which is
  // exactly when the marker is the only thing left saying where you are. The
  // marker spends a cell the fold already had: it replaces one of the trailing
  // spaces, so no style gets wider.
  const chrome = resolveRowSelectionChrome(theme, { cursor: row.selected })
  return (
    <box
      flexShrink={0}
      flexDirection="row"
      backgroundColor={chrome.backgroundColor}
      onMouseUp={() => props.onSelect(row.task.id)}
    >
      {props.style === "hairline" ? null : (
        <text fg={chrome.markerColor ?? fg} wrapMode="none" flexShrink={0}>
          {row.selected ? chrome.marker : " "}
        </text>
      )}
      <RailCell row={row} style={props.style} fg={fg} />
    </box>
  )
}

function RailCell(props: { row: RailRow; style: CollapsedRailStyle; fg: string | RGBA }) {
  const { theme } = useTheme()
  const { row, fg } = props
  switch (props.style) {
    // A: the state as a solid bar. Nothing to read, only to notice — the
    // colour IS the message, and the strip costs the workspace two columns.
    case "hairline":
      return (
        <text fg={fg} wrapMode="none">
          {row.selected ? "█ " : "▎ "}
        </text>
      )
    // B: the jump digit, tinted by state. Keeps the one thing a collapsed
    // rail can still act on — the number you press to get there.
    case "digits":
      return (
        <text fg={fg} attributes={row.selected ? TextAttributes.BOLD : undefined} wrapMode="none">
          {`${row.digit ?? "·"} `}
        </text>
      )
    // C: the status glyph itself, the same one the expanded card shows.
    case "glyphs":
      return (
        <text fg={fg} attributes={row.selected ? TextAttributes.BOLD : undefined} wrapMode="none">
          {`${row.glyph}  `}
        </text>
      )
    // D: glyph plus two letters of the title — the widest fold, and the only
    // one where a row is still identifiable without counting positions.
    default:
      return (
        <box flexDirection="row" flexShrink={0}>
          <text fg={fg} wrapMode="none" flexShrink={0}>
            {`${row.glyph} `}
          </text>
          <text
            fg={row.selected ? theme.text : theme.textMuted}
            attributes={row.selected ? TextAttributes.BOLD : undefined}
            wrapMode="none"
            flexShrink={0}
          >
            {railInitials(row.task.title ?? "")}
          </text>
        </box>
      )
  }
}
