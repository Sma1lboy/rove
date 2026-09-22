/** @jsxImportSource @opentui/react */
/**
 * The sidebar's COLLAPSED rail: the task list folded to a strip a few cells
 * wide. Glyph and tone come from `buildSidebarRowView`, so a folded row can't
 * disagree with its card; groups are the expanded tree's `SidebarGroup[]`.
 *
 * `glyphs` is the default: the row's own status glyph in its state colour is
 * the most a four-cell strip can say about a task. The rest stay as a
 * preference.
 */

import type { TaskEngineState, TaskJobState } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { type RGBA, TextAttributes } from "@opentui/core"
import { Fragment, useMemo } from "react"
import { displayWidth } from "../../../lib/display-width"
import { type SidebarGroup, ownTasks } from "../../../tui/panes/sidebar/project-groups"
import { buildSidebarRowView, withSpinnerFrame } from "../../../tui/panes/sidebar/row-view"
import { toneColor } from "../../../tui/panes/sidebar/view-core"
import { useTheme } from "../../context/theme"
import { resolveRowSelectionChrome } from "../../ui/row-selection-chrome"
import { CollapseButton } from "./collapse-button"
import { useSpinnerFrame } from "./row-cards"

export type CollapsedRailStyle = "hairline" | "glyphs" | "initials"

export const DEFAULT_COLLAPSED_RAIL_STYLE: CollapsedRailStyle = "glyphs"

/** Cycle order for the setting, default first. */
export const COLLAPSED_RAIL_STYLES: readonly CollapsedRailStyle[] = ["glyphs", "initials", "hairline"]

/** Rail width in cells per style. */
export const COLLAPSED_RAIL_WIDTH: Record<CollapsedRailStyle, number> = {
  hairline: 2,
  glyphs: 4,
  initials: 7,
}

/** Two cells for a title: initials across words, else its first two characters. */
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
  // Routine sessions take no cell: the fold has no room for the tree's count
  // row, and a daily schedule would make the folded rail the longer surface.
  const tasks = useMemo(() => props.groups.flatMap(ownTasks), [props.groups])
  // One spinner clock: per-row hooks would put rows out of phase.
  const spinning = tasks.some((task) => props.taskJobs?.get(task.id) !== undefined)
  const frame = useSpinnerFrame(spinning)
  // An all-routine project has nothing to draw, so no divider either.
  return props.groups
    .filter((group) => ownTasks(group).length > 0)
    .map((group) => ({
      key: group.key,
      label: group.label,
      rows: ownTasks(group).map((task) => {
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
          selected: task.id === props.selectedId,
        }
      }),
    }))
}

export interface CollapsedRailProps {
  readonly style: CollapsedRailStyle
  /** The very sections the expanded tree renders. */
  readonly groups: readonly SidebarGroup[]
  readonly selectedId: string | null
  readonly engineState?: ReadonlyMap<string, TaskEngineState>
  readonly taskJobs?: ReadonlyMap<string, TaskJobState>
  readonly onSelect: (taskId: string) => void
  readonly onExpand: () => void
}

/** Divider: first char of the group LABEL, then a rule. The label, not the
 *  basename, is already disambiguated (`work/api` vs `oss/api`). */
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
  // The same `▌` marker as the expanded rows: under a transparent theme there
  // is no selection background, so the marker is the only signal. It takes a
  // cell the fold already had, so no style gets wider.
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
    // A: the colour IS the message; two columns.
    case "hairline":
      return (
        <text fg={fg} wrapMode="none">
          {row.selected ? "█ " : "▎ "}
        </text>
      )
    // B: the status glyph.
    case "glyphs":
      return (
        <text fg={fg} attributes={row.selected ? TextAttributes.BOLD : undefined} wrapMode="none">
          {`${row.glyph}  `}
        </text>
      )
    // C: glyph + two title letters; the only style identifiable without counting.
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
