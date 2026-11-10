/** @jsxImportSource @opentui/react */
/** The tree's Archived fold row. */

import { charWidth } from "../../../lib/display-width"
import { truncateEndCells } from "../../../tui/lib/truncate"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { RowShell, type TreeRowShared, treeLabelBudget } from "./tree-row-shell"

/**
 * The Archived fold at the end of the tree: archived tasks stay one press
 * away (their menu offers Unarchive) without crowding the projects above.
 * Flush with the project headers: it is a section of its own, not a project's row.
 */
export function ArchivedTreeRow(props: {
  readonly rowId: string
  readonly flatIndex: number
  readonly count: number
  readonly expanded: boolean
  readonly shared: TreeRowShared
}) {
  const { theme } = useTheme()
  const t = useT()
  const label = truncateEndCells(
    t("tasks.archivedRow", { count: String(props.count) }),
    treeLabelBudget(props.shared, 2),
    charWidth,
  )
  return (
    <RowShell rowId={props.rowId} flatIndex={props.flatIndex} depth={0} shared={props.shared}>
      {/* A 2-cell twisty is terminal grammar for "this opens", the same
          fixed-glyph exception the diff gutter takes. */}
      <text fg={theme.textMuted} wrapMode="none" width={2} flexShrink={0}>
        {props.expanded ? "▾ " : "▸ "}
      </text>
      <text fg={theme.textMuted} wrapMode="none" flexShrink={1}>
        {label}
      </text>
    </RowShell>
  )
}
