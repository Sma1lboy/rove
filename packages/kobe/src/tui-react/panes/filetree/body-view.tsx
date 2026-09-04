/** @jsxImportSource @opentui/react */
/**
 * The file tree's scrolling body: the one scrollbox, its four states (no
 * worktree / git error / empty / rows), and the viewport windowing that keeps
 * a large tree cheap to draw.
 *
 * Split out of `FileTree.tsx` along the seam that file already names in its
 * siblings (`header-view`, `row-view`): everything above owns the pane's
 * state, git reads and keys; everything here owns the list and where it is
 * scrolled to. Cursor position comes in as a prop — deciding which row the
 * cursor is on stays with the pane, only following it with the viewport lives
 * here.
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
  // Only the rows the viewport can show are mounted; the rest are two spacer
  // boxes that hold the content's height. See `use-row-window.ts` for why
  // opentui's own culling does not already cover this.
  const rowWindow = useRowWindow({ scrollEl, rowCount: rows.length })

  // Follow the cursor, then re-read the position immediately: a jump longer
  // than one viewport would otherwise leave the window that is no longer on
  // screen mounted, and the pane blank until something else asks for a redraw.
  //
  // Keyed on `rows.length`, NOT on `rows`: that array has a fresh identity
  // every render, and an effect that both re-runs every render and sets state
  // is a render loop. Following only ever depends on where the cursor is and
  // how tall the list is.
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
      // Stable setter, not an inline arrow: a fresh ref-callback identity makes
      // React detach and reattach on every render, and each pair costs an extra
      // commit of the whole pane.
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
