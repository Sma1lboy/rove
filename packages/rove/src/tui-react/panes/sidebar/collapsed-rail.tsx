/** @jsxImportSource @opentui/react */
/**
 * The sidebar's COLLAPSED rail: the task list folded to a strip a few cells
 * wide. Glyph and tone are the daemon's row status (`row-status-sync.ts`)
 * through `buildSidebarRowView`, so a folded row can't disagree with the
 * tree; rows are the expanded tree's (`buildRowsFromGroups`), so a child task
 * nests under its parent here too. A task is ONE cell; its tabs are the tab
 * strip's business, not the rail's.
 *
 * `glyphs` is the default: the row's own status glyph in its state colour is
 * the most a four-cell strip can say about a task. The rest stay as a
 * preference. A child steps in one cell per generation and wears the tree's
 * `⑂` shared / `⎇` own-worktree marker wherever the width has room;
 * `hairline` has no room for either.
 */

import type { Task } from "@/types/task"
import { type RGBA, TextAttributes } from "@opentui/core"
import { Fragment, useMemo } from "react"
import { displayWidth } from "../../../lib/display-width"
import { breathColor } from "../../../tui/lib/breathe"
import type { SidebarGroup } from "../../../tui/panes/sidebar/project-groups"
import { buildSidebarRowView, rowIsLoading, withSpinnerFrame } from "../../../tui/panes/sidebar/row-view"
import { type ChildMarker, buildRowsFromGroups, childMarkerOf } from "../../../tui/panes/sidebar/tree-core"
import { toneColor } from "../../../tui/panes/sidebar/view-core"
import { useTheme } from "../../context/theme"
import { useGlyphs } from "../../lib/use-glyphs"
import { resolveRowSelectionChrome } from "../../ui/row-selection-chrome"
import { taskRowStatus, useRowStatusMap } from "../../workspace/row-status-sync"
import { CollapseButton } from "./collapse-button"
import { useSpinnerFrame } from "./row-cards"
import { SHARED_MARK, WORKTREE_MARK } from "./tree-rows"

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
  /** Shared spinner tick while the row runs; its accent breathes on it. */
  readonly breath?: number
  readonly selected: boolean
  /** The tree's indent level: 1 for a top-level task, +1 per generation, held at the tree's cap. */
  readonly depth: number
  /** Set on a child task: where it runs. */
  readonly marker: ChildMarker | null
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
}): readonly RailSection[] {
  // The tree's own rows, so the rail nests exactly as the tree does. Routine
  // sessions take no cell: the fold has no room for the tree's count row, and a
  // daily schedule would make the folded rail the longer surface. Their rows
  // only exist while the (here never opened) fold is open.
  const treeRows = useMemo(() => buildRowsFromGroups({ groups: props.groups }), [props.groups])
  const tasks = useMemo(() => treeRows.flatMap((row) => (row.kind === "worktree" ? [row.task] : [])), [treeRows])
  // One spinner clock: per-row hooks would put rows out of phase.
  const statuses = useRowStatusMap()
  const spinning = tasks.some((task) => rowIsLoading(taskRowStatus(statuses, task.id)))
  const frame = useSpinnerFrame(spinning)
  const glyphs = useGlyphs()
  // A project drawn only by tasks nested elsewhere has no header row, so no divider either.
  const sections: { key: string; label: string; rows: RailRow[] }[] = []
  for (const row of treeRows) {
    if (row.kind === "project") {
      sections.push({ key: row.id, label: row.label, rows: [] })
      continue
    }
    if (row.kind !== "worktree") continue
    const base = buildSidebarRowView({
      task: row.task,
      status: taskRowStatus(statuses, row.task.id),
      spinnerFrame: frame,
      subtitleBudget: 0,
      truncateBranch: (branch) => branch,
      glyphs,
    })
    const view = withSpinnerFrame(base, () => frame)
    sections[sections.length - 1]?.rows.push({
      task: row.task,
      glyph: view.stateGlyph,
      tone: view.tone,
      breath: spinning && view.loading ? frame : undefined,
      selected: row.task.id === props.selectedId,
      depth: row.depth,
      marker: childMarkerOf(row.task),
    })
  }
  return sections
}

export interface CollapsedRailProps {
  readonly style: CollapsedRailStyle
  /** The very sections the expanded tree renders. */
  readonly groups: readonly SidebarGroup[]
  readonly selectedId: string | null
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
  const fg =
    row.breath !== undefined && row.tone === "primary"
      ? breathColor(theme.primary, theme.textMuted, row.breath)
      : toneColor(theme, row.tone)
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
  const bold = row.selected ? TextAttributes.BOLD : undefined
  // A child steps in one cell per generation, as far as the style's width has spare cells.
  const indent = " ".repeat(Math.min(row.depth - 1, props.style === "initials" ? 2 : 1))
  const mark = row.marker ? (
    <text fg={row.marker === "shared" ? theme.info : theme.textMuted} wrapMode="none" flexShrink={0}>
      {row.marker === "shared" ? SHARED_MARK : WORKTREE_MARK}
    </text>
  ) : null
  switch (props.style) {
    // A: the colour IS the message; two columns, no room to nest.
    case "hairline":
      return (
        <text fg={fg} wrapMode="none">
          {row.selected ? "█ " : "▎ "}
        </text>
      )
    // B: the status glyph, then the child marker.
    case "glyphs":
      return (
        <box flexDirection="row" flexShrink={0}>
          <text fg={fg} attributes={bold} wrapMode="none" flexShrink={0}>
            {`${indent}${row.glyph}`}
          </text>
          {mark}
          <text wrapMode="none" flexShrink={0}>
            {" ".repeat(Math.max(0, 2 - indent.length - (mark ? 1 : 0)))}
          </text>
        </box>
      )
    // C: glyph + two title letters; the only style identifiable without counting.
    default:
      return (
        <box flexDirection="row" flexShrink={0}>
          <text fg={fg} wrapMode="none" flexShrink={0}>
            {`${indent}${row.glyph}${mark ? "" : " "}`}
          </text>
          {mark}
          <text fg={row.selected ? theme.text : theme.textMuted} attributes={bold} wrapMode="none" flexShrink={0}>
            {railInitials(row.task.title ?? "")}
          </text>
        </box>
      )
  }
}
