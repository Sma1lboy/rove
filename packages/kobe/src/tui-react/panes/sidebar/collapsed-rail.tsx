/** @jsxImportSource @opentui/react */
/**
 * The sidebar's COLLAPSED rail: the task list folded to a strip a few cells
 * wide. Glyph and tone come from `buildSidebarRowView`, so a folded row can't
 * disagree with its card; groups are the expanded tree's `SidebarGroup[]`.
 *
 * `glyphs` is the default: the row's own status glyph in its state colour is
 * the most a four-cell strip can say about a task. The rest stay as a
 * preference.
 *
 * A task whose tabs are known folds to ONE CELL PER TAB instead: the tab's
 * number (what `ctrl+<N>` reaches) in that tab's own state colour, so a second
 * chat's turn is visible folded. The count restarting at 1 marks the next task.
 * `hairline` has no room for a digit and stays one cell per task.
 */

import type { TaskEngineState, TaskJobState } from "@/client/remote-orchestrator"
import type { Task } from "@/types/task"
import { type RGBA, TextAttributes } from "@opentui/core"
import { Fragment, useMemo } from "react"
import { displayWidth } from "../../../lib/display-width"
import { type SidebarGroup, ownTasks } from "../../../tui/panes/sidebar/project-groups"
import { buildSidebarRowView, withSpinnerFrame } from "../../../tui/panes/sidebar/row-view"
import type { TreeTab } from "../../../tui/panes/sidebar/tree-core"
import { toneColor } from "../../../tui/panes/sidebar/view-core"
import { useTheme } from "../../context/theme"
import { resolveRowSelectionChrome } from "../../ui/row-selection-chrome"
import { CollapseButton } from "./collapse-button"
import { useSpinnerFrame } from "./row-cards"
import { useTabStateCell } from "./tree-rows"

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
  /** Set when the task folds to one cell per tab (see the file header). */
  readonly tabs?: readonly TreeTab[]
}

/** The digit a tab cell prints: its `ctrl+<N>` slot, `·` past the ninth. */
export function railTabDigit(index: number): string {
  return index < 9 ? String(index + 1) : "·"
}

/** One divider plus the rows under it — a project, or the scratch bench. */
interface RailSection {
  readonly key: string
  readonly label: string
  readonly rows: readonly RailRow[]
}

function useRailSections(props: {
  style: CollapsedRailStyle
  groups: readonly SidebarGroup[]
  tabsByTask?: ReadonlyMap<string, readonly TreeTab[]>
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
        const tabs = props.style === "hairline" ? undefined : props.tabsByTask?.get(task.id)
        return {
          task,
          glyph: view.stateGlyph,
          tone: view.tone,
          selected: task.id === props.selectedId,
          tabs: tabs && tabs.length > 0 ? tabs : undefined,
        }
      }),
    }))
}

export interface CollapsedRailProps {
  readonly style: CollapsedRailStyle
  /** The very sections the expanded tree renders. */
  readonly groups: readonly SidebarGroup[]
  /** Each task's tabs; absent (or no entry) keeps that task one cell. */
  readonly tabsByTask?: ReadonlyMap<string, readonly TreeTab[]>
  readonly selectedId: string | null
  readonly engineState?: ReadonlyMap<string, TaskEngineState>
  /** Per-tab activity, keyed taskId → tabId: colours the tab cells. */
  readonly engineTabState?: ReadonlyMap<string, ReadonlyMap<string, TaskEngineState>>
  readonly engineLifecycle?: ReadonlyMap<string, { readonly subagents: number }>
  readonly taskJobs?: ReadonlyMap<string, TaskJobState>
  readonly onSelect: (taskId: string) => void
  /** Clicking a tab cell; absent falls back to selecting its task. */
  readonly onSelectTab?: (taskId: string, tabId: string) => void
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
          {section.rows.map((row) =>
            row.tabs ? (
              row.tabs.map((tab, index) => (
                <RailTabRowView key={`${row.task.id}:${tab.id}`} row={row} tab={tab} index={index} rail={props} />
              ))
            ) : (
              <RailRowView key={row.task.id} row={row} style={props.style} onSelect={props.onSelect} />
            ),
          )}
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

/** One tab of a task folded to per-tab cells: the digit takes the glyph's cell. */
function RailTabRowView(props: { row: RailRow; tab: TreeTab; index: number; rail: CollapsedRailProps }) {
  const { theme } = useTheme()
  const { row, tab, rail } = props
  const taskId = row.task.id
  const cell = useTabStateCell({
    task: row.task,
    tab,
    tabStates: rail.engineTabState?.get(taskId),
    lifecycle: rail.engineLifecycle?.get(taskId),
    job: rail.taskJobs?.get(taskId),
    viewing: row.selected && tab.active === true,
  })
  const selected = row.selected && tab.active === true
  const chrome = resolveRowSelectionChrome(theme, { cursor: selected })
  const bold = selected || cell.pulsing ? TextAttributes.BOLD : undefined
  const onSelect = () => (rail.onSelectTab ? rail.onSelectTab(taskId, tab.id) : rail.onSelect(taskId))
  return (
    <box flexShrink={0} flexDirection="row" backgroundColor={chrome.backgroundColor} onMouseUp={onSelect}>
      <text fg={chrome.markerColor ?? cell.fg} wrapMode="none" flexShrink={0}>
        {selected ? chrome.marker : " "}
      </text>
      <text fg={cell.fg} attributes={bold} wrapMode="none" flexShrink={0}>
        {`${railTabDigit(props.index)} `}
      </text>
      {rail.style === "initials" ? (
        <text
          fg={row.selected ? theme.text : theme.textMuted}
          attributes={row.selected ? TextAttributes.BOLD : undefined}
          wrapMode="none"
          flexShrink={0}
        >
          {props.index === 0 ? railInitials(row.task.title ?? "") : "  "}
        </text>
      ) : (
        <text wrapMode="none" flexShrink={0}>
          {" "}
        </text>
      )}
    </box>
  )
}
