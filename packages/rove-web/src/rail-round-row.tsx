/** A parallel round's header row in the rail: its title and attempt count; a click opens the Compare page. */

import { t } from "./i18n/index.ts"
import { openCompare } from "./layout.ts"
import type { TreeGuide } from "./rail-blocks.ts"
import type { RowPlace } from "./rail-drag.ts"
import { mostUrgentStatus } from "./rail-glyphs.ts"
import type { NavRow } from "./rail.ts"
import { CHILD_INDENT, RAIL_CURSOR, guideClass } from "./ui/rail.ts"
import { CHIPS, ROW_TITLE, rowClass } from "./ui/row.ts"
import { StatusDots } from "./ui/status-dots.tsx"

export type RoundRow = Extract<NavRow, { kind: "round" }>

export function RoundRowView(props: {
  row: RoundRow
  guides?: readonly TreeGuide[] | undefined
  /** The round's project, named when the rail has no project headers. */
  repo?: string | undefined
  cursor: boolean
  place: RowPlace
  onClick: () => void
}) {
  const { row } = props
  return (
    <button // ui-ok: a rail row is a button in the row recipe (`rowClass`), as the pane and task rows are
      type="button"
      className={`${rowClass({ size: "pane" })} ${props.cursor ? RAIL_CURSOR : ""}`}
      title={t("compare.menu")}
      onClick={() => {
        props.onClick()
        openCompare(row.groupId)
      }}
      {...props.place}
    >
      {props.guides && (
        <span className={CHILD_INDENT} aria-hidden="true">
          {props.guides.map((guide, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a column's place is its identity
            <span key={i} className={guideClass(guide)} />
          ))}
        </span>
      )}
      <span className={`${ROW_TITLE} text-(length:--fs-meta) text-muted`}>{row.title}</span>
      <span className={`${CHIPS} ml-auto items-center`}>
        {props.repo && <span className="max-w-24 truncate text-subtle">{props.repo}</span>}
        <span className="text-subtle">{row.tasks.length}</span>
        <StatusDots status={mostUrgentStatus(row.tasks)} />
      </span>
    </button>
  )
}
