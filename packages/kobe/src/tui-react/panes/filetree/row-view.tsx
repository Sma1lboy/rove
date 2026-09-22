/** @jsxImportSource @opentui/react */
/**
 * One file tree row. The cursor row uses the Sidebar's neutral marker +
 * `backgroundElement` tint, not a solid fill, so semantic colours survive.
 *
 * Memoized: every prop is identity-stable across a j/k move, so a keystroke
 * re-renders only the two rows whose `cursor` flag flipped.
 */

import { TextAttributes } from "@opentui/core"
import { memo } from "react"
import { displayWidth } from "../../../lib/display-width"
import { type StatWidths, statCell, statusToken } from "../../../tui/panes/filetree/pane-core"
import { type Row, truncatePathTail } from "../../../tui/panes/filetree/rows"
import { useTheme } from "../../context/theme"
import { resolveRowSelectionChrome } from "../../ui/row-selection-chrome"

export type FileTreeRowProps = {
  row: Row
  /** Row index in the flattened list — echoed back through `onActivate`. */
  index: number
  cursor: boolean
  /** Shared stat column widths (Changes tab). */
  statWidths: StatWidths
  /** Path cell budget (Changes tab). */
  pathBudget: number
  /** ONE stable callback shared by all rows (memo-friendly). */
  onActivate: (row: Row, index: number) => void
}

export const FileTreeRowView = memo(function FileTreeRowView(props: FileTreeRowProps) {
  const { theme } = useTheme()
  const selection = resolveRowSelectionChrome(theme, { cursor: props.cursor })
  const bar = (
    <text fg={selection.markerColor} wrapMode="none">
      {selection.marker}
    </text>
  )
  const rowBg = selection.backgroundColor
  const row = props.row
  if (row.kind === "dir") {
    // Indent: 2 cells per depth level. Marker: ▾ open, ▸ closed.
    const indent = "  ".repeat(row.depth)
    return (
      <box
        flexDirection="row"
        gap={0}
        backgroundColor={rowBg}
        onMouseUp={() => props.onActivate(props.row, props.index)}
      >
        {bar}
        <box flexGrow={1} paddingRight={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD} wrapMode="none">
            {`${indent}${row.expanded ? "▾" : "▸"} ${row.name}/`}
          </text>
        </box>
      </box>
    )
  }
  if (row.kind === "file") {
    const indent = "  ".repeat(row.depth)
    // Two-cell gutter where the dir marker would sit.
    return (
      <box
        flexDirection="row"
        gap={0}
        backgroundColor={rowBg}
        onMouseUp={() => props.onActivate(props.row, props.index)}
      >
        {bar}
        <box flexGrow={1} paddingRight={1}>
          <text fg={theme.text} wrapMode="none">
            {`${indent}  ${row.name}`}
          </text>
        </box>
      </box>
    )
  }
  // Changes row. An untracked dir (fileCount set) is muted so an asset dump
  // doesn't shout over tracked changes.
  const isUntrackedDir = row.fileCount !== undefined
  const marker = isUntrackedDir ? (row.expanded ? "▾ " : "▸ ") : ""
  const countSuffix = isUntrackedDir ? ` (${row.fileCount})` : ""
  const indent = row.child ? "  " : ""
  // Everything on the line spends the path's CELL budget: `.length` would
  // under-charge a wide glyph and reopen the overflow `truncatePathTail` closes.
  const pathBudget = props.pathBudget - displayWidth(marker) - displayWidth(countSuffix) - displayWidth(indent)
  const tone = statusToken(row.status)
  const statusColor =
    tone === "success"
      ? theme.success
      : tone === "warning"
        ? theme.warning
        : tone === "error"
          ? theme.error
          : tone === "info"
            ? theme.info
            : theme.textMuted
  return (
    <box flexDirection="row" gap={0} backgroundColor={rowBg} onMouseUp={() => props.onActivate(props.row, props.index)}>
      {bar}
      <box flexDirection="row" flexGrow={1} gap={1} paddingRight={1}>
        <text fg={statusColor} wrapMode="none">
          {row.status}
        </text>
        <text fg={isUntrackedDir ? theme.textMuted : theme.text} wrapMode="none" flexGrow={1}>
          {`${indent}${marker}${truncatePathTail(row.path, pathBudget)}${countSuffix}`}
        </text>
        {props.statWidths.added > 0 ? (
          <text fg={theme.success} wrapMode="none">
            {statCell(row.added, props.statWidths.added, "+")}
          </text>
        ) : null}
        {props.statWidths.deleted > 0 ? (
          <text fg={theme.error} wrapMode="none">
            {statCell(row.deleted, props.statWidths.deleted, "-")}
          </text>
        ) : null}
      </box>
    </box>
  )
})
