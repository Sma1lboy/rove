/** @jsxImportSource @opentui/react */
/**
 * The file tree's scrolling body: four states (no worktree / git error /
 * empty / rows) and viewport windowing. The pane decides the cursor row; this
 * only follows it with the viewport.
 */

import type { ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useState } from "react"
import type { StatWidths } from "../../../tui/panes/filetree/pane-core"
import { followScrollTop, gitErrorIsRetryable, summarizeGitError } from "../../../tui/panes/filetree/pane-core"
import type { Row } from "../../../tui/panes/filetree/rows"
import { useTheme } from "../../context/theme"
import { useT } from "../../i18n"
import { FileTreeRowView } from "./row-view"
import { useRowWindow } from "./use-row-window"

export function FileTreeBodyView(props: {
  readonly rows: readonly Row[]
  readonly cursorIndex: number
  readonly statWidths: StatWidths
  readonly pathBudget: number
  readonly onActivate: (row: Row, index: number) => void
  /** `null` renders the "no task" placeholder instead of a list. */
  readonly worktreePath: string | null
  readonly error: string | null
  /** The active tab's git read has landed — tells an empty list from a pending one. */
  readonly loaded: boolean
  readonly tab: "all" | "changes"
}) {
  const { theme } = useTheme()
  const t = useT()
  const { rows, cursorIndex } = props

  // The scrollbox is held as STATE, not a ref: `useRowWindow` subscribes to
  // its scrollbar, so it has to re-run when the element itself changes.
  const [scrollEl, setScrollEl] = useState<ScrollBoxRenderable | null>(null)
  // Only visible rows mount; two spacer boxes hold the height (see `use-row-window.ts`).
  const rowWindow = useRowWindow({ scrollEl, rowCount: rows.length })

  // Follow the cursor, then re-sample at once: a jump longer than one viewport
  // would otherwise leave the off-screen window mounted and the pane blank.
  // Keyed on `rows.length`, NOT `rows`: a fresh array every render + setState
  // would be a render loop.
  const rowCount = rows.length
  const sample = rowWindow.sample
  useEffect(() => {
    if (!scrollEl || rowCount === 0) return
    const y = followScrollTop(scrollEl.scrollTop, scrollEl.viewport.height, cursorIndex)
    if (y != null) scrollEl.scrollTo({ x: 0, y })
    sample()
  }, [cursorIndex, rowCount, scrollEl, sample])

  return (
    // Track + thumb both transparent → invisible by default but still scrollable.
    <scrollbox
      // Stable setter: an inline ref callback detaches/reattaches every render.
      ref={setScrollEl}
      flexGrow={1}
      verticalScrollbarOptions={{ trackOptions: { foregroundColor: "transparent" } }}
    >
      {props.worktreePath == null ? (
        <box paddingTop={1} paddingLeft={1}>
          <text fg={theme.textMuted}>{t("files.empty.noTask")}</text>
        </box>
      ) : props.error != null ? (
        <box paddingTop={1} paddingLeft={1} flexDirection="column" gap={0}>
          <text fg={theme.error} wrapMode="word">
            {summarizeGitError(props.error, t)}
          </text>
          {gitErrorIsRetryable(props.error) ? (
            <text fg={theme.textMuted} wrapMode="word">
              {t("files.error.retryHint")}
            </text>
          ) : null}
        </box>
      ) : rows.length === 0 && props.loaded ? (
        <box paddingTop={1} paddingLeft={1}>
          <text fg={theme.textMuted}>
            {props.tab === "all" ? t("files.empty.noFiles") : t("files.empty.noChanges")}
          </text>
        </box>
      ) : rows.length > 0 ? (
        <box flexShrink={0} gap={0} paddingRight={1}>
          {rowWindow.start > 0 ? <box flexShrink={0} height={rowWindow.start} /> : null}
          {rows.slice(rowWindow.start, rowWindow.end).map((row, offset) => {
            const index = rowWindow.start + offset
            return (
              <FileTreeRowView
                key={`${row.kind}:${row.path}`}
                row={row}
                index={index}
                cursor={index === cursorIndex}
                statWidths={props.statWidths}
                pathBudget={props.pathBudget}
                onActivate={props.onActivate}
              />
            )
          })}
          {rows.length > rowWindow.end ? <box flexShrink={0} height={rows.length - rowWindow.end} /> : null}
        </box>
      ) : null}
    </scrollbox>
  )
}
