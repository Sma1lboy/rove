/** @jsxImportSource @opentui/react */
/**
 * The sidebar tree's body: ONE scrollbox of one-line rows (the cursor indexes
 * one flat id list). A project's routine count row folds the sessions a
 * SCHEDULE created and a task folds its child tasks; everything else a human
 * opened shows. Archived tasks are not listed (the palette finds them).
 */

import type { ScrollBoxRenderable } from "@opentui/core"
import { treeGuides } from "@sma1lboy/rove-core/lib/tree-guides.ts"
import { SCRATCH_SECTION_ID, type TreeRow } from "../../../tui/panes/sidebar/tree-core"
import { sidebarEmptyStateKey } from "../../../tui/panes/sidebar/view-core"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { SectionHeader } from "./chrome"
import type { TreeRowShared } from "./tree-row-shell"
import { RecentJumpRow, WorktreeTreeRow } from "./tree-rows"

/** A project header's text: Ungrouped and the built-in chat connectors by name, any other project by its folder. */
export function projectHeaderLabel(row: Extract<TreeRow, { kind: "project" }>, t: ReturnType<typeof useT>): string {
  if (row.id === SCRATCH_SECTION_ID) return t("tasks.header.scratch")
  if (row.connector === "weixin" || row.connector === "lark") return t(`tasks.header.connector.${row.connector}`)
  return row.label
}

export function SidebarTreeBody(props: {
  readonly rows: readonly TreeRow[]
  /** Row id → index in the tree's navigable flat id list. */
  readonly flatIndexOf: ReadonlyMap<string, number>
  /** Non-empty query open: "no matches" empty state instead of "nothing here yet". */
  readonly searching: boolean
  readonly shared: TreeRowShared
  readonly collapsedProjects?: ReadonlySet<string>
  readonly onToggleProject?: (id: string) => void
  /** A project header's `+`: a new task in that project. */
  readonly onAddTask?: (repo: string) => void
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
          if (row.kind === "project") {
            // Scratch is a fixed section, not a repo: its menu offers only the two ways to start with no folder.
            const isScratch = row.id === SCRATCH_SECTION_ID
            return (
              <SectionHeader
                key={row.id}
                label={projectHeaderLabel(row, t)}
                suffix={props.movingProjectId === row.id ? t("tasks.moveChip") : undefined}
                collapsed={props.onToggleProject ? props.collapsedProjects?.has(row.id) === true : undefined}
                onPress={() => props.onToggleProject?.(row.id)}
                // Scratch is no repo to start a task in; another machine's project has no checkout here.
                onAdd={
                  props.onAddTask && !isScratch && row.machineId === "local"
                    ? () => props.onAddTask?.(row.repo)
                    : undefined
                }
                topPad={i > 0}
                depth={row.depth}
                onContextMenu={
                  props.onProjectContextMenu ? (x, y) => props.onProjectContextMenu?.(row.id, x, y) : undefined
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
          return (
            <WorktreeTreeRow
              key={row.id}
              rowId={row.id}
              flatIndex={props.flatIndexOf.get(row.id) ?? -1}
              task={row.task}
              depth={row.depth}
              guides={treeGuides(props.rows.length, (index) => props.rows[index]?.depth ?? 0, i)}
              level={row.level}
              fold={row.fold}
              remote={row.remote}
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
