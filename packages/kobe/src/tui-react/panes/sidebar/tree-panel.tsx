/** @jsxImportSource @opentui/react */
/**
 * The sidebar tree's body: ONE scrollbox of one-line rows (the cursor indexes
 * one flat id list). The only fold is a project's routine count row, which
 * hides sessions a SCHEDULE created; everything a human opened shows.
 */

import type { ScrollBoxRenderable } from "@opentui/core"
import { machineRowLabel } from "../../../tui/panes/sidebar/machine-layer"
import { SCRATCH_SECTION_ID, type TreeRow } from "../../../tui/panes/sidebar/tree-core"
import { sidebarEmptyStateKey } from "../../../tui/panes/sidebar/view-core"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { SectionHeader } from "./chrome"
import type { TreeRowShared } from "./tree-row-shell"
import { RecentJumpRow, RoutinesTreeRow, TabTreeRow, WorktreeTreeRow } from "./tree-rows"

export function SidebarTreeBody(props: {
  readonly rows: readonly TreeRow[]
  /** Row id → index in the tree's navigable flat id list. */
  readonly flatIndexOf: ReadonlyMap<string, number>
  /** Non-empty query open: "no matches" empty state instead of "nothing here yet". */
  readonly searching: boolean
  readonly shared: TreeRowShared
  readonly onProjectContextMenu?: (projectId: string, x: number, y: number) => void
  /** Project being dragged in move mode — wears the move chip. */
  readonly movingProjectId?: string | null
  readonly setScrollRef: (renderable: ScrollBoxRenderable | null) => void
}) {
  const { theme } = useTheme()
  const t = useT()
  return (
    <scrollbox
      ref={props.setScrollRef}
      flexGrow={1}
      minHeight={0}
      stickyScroll={false}
      // Hidden: the cursor drives scrolling.
      verticalScrollbarOptions={{ visible: false }}
    >
      <box flexShrink={0} gap={0}>
        {props.rows.map((row, i) => {
          if (row.kind === "machine") {
            // Machine header, one rung above projects. Offline/mismatched
            // machines grey out: a stale snapshot must not read as live.
            return (
              <SectionHeader
                key={row.id}
                label={machineRowLabel(
                  { alias: row.alias, hostLabel: row.label, state: row.state, version: row.version },
                  t,
                )}
                topPad={i > 0}
                muted={row.state !== "online"}
              />
            )
          }
          if (row.kind === "project") {
            // Scratch is a fixed section, not a repo: no context menu.
            const isScratch = row.id === SCRATCH_SECTION_ID
            return (
              <SectionHeader
                key={row.id}
                label={isScratch ? t("tasks.header.scratch") : row.label}
                suffix={props.movingProjectId === row.id ? t("tasks.moveChip") : undefined}
                topPad={i > 0}
                depth={row.depth}
                onContextMenu={
                  props.onProjectContextMenu && !isScratch
                    ? (x, y) => props.onProjectContextMenu?.(row.id, x, y)
                    : undefined
                }
              />
            )
          }
          if (row.kind === "recent") {
            return (
              <RecentJumpRow
                key={row.id}
                rowId={row.id}
                flatIndex={props.flatIndexOf.get(row.id) ?? -1}
                task={row.task}
                shared={props.shared}
              />
            )
          }
          if (row.kind === "routines") {
            return (
              <RoutinesTreeRow
                key={row.id}
                rowId={row.id}
                flatIndex={props.flatIndexOf.get(row.id) ?? -1}
                count={row.count}
                expanded={row.expanded}
                shared={props.shared}
              />
            )
          }
          if (row.kind === "worktree") {
            return (
              <WorktreeTreeRow
                key={row.id}
                rowId={row.id}
                flatIndex={props.flatIndexOf.get(row.id) ?? -1}
                task={row.task}
                depth={row.depth}
                shared={props.shared}
              />
            )
          }
          return (
            <TabTreeRow
              key={row.id}
              rowId={row.id}
              flatIndex={props.flatIndexOf.get(row.id) ?? -1}
              task={row.task}
              tab={row.tab}
              depth={row.depth - 1}
              shared={props.shared}
            />
          )
        })}
        {props.rows.length === 0 ? (
          <box paddingTop={1} paddingLeft={1}>
            <text fg={theme.textMuted}>
              {t(sidebarEmptyStateKey({ searching: props.searching, projectFilter: false }))}
            </text>
          </box>
        ) : null}
      </box>
    </scrollbox>
  )
}
