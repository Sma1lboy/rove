/** @jsxImportSource @opentui/react */
/**
 * Diff review overlay for the preview tab: line cursor over the unified
 * `<diff>`, range select, note dialog, send-all. Pure logic lives in
 * `src/tui/ops/diff-comments.ts`; this file owns React state, bindings, and
 * imperative paint/scroll on the DiffRenderable.
 *
 * PROPOSED chords (owner sign-off pending): j/k/down/up cursor · v range ·
 * c note · s send-all · x drop note. Active only while the diff tab has
 * workspace focus.
 */

import type { DiffRenderable, RGBA } from "@opentui/core"
import { CodeRenderable } from "@opentui/core"
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react"
import { bindByIds, findBinding } from "../../tui/context/keybindings"
import {
  type DiffReviewApi,
  type DiffRow,
  type ReviewPaintKind,
  commentAtRow,
  commentRange,
  computeReviewPaint,
  unifiedDiffRows,
  unsentComments,
} from "../../tui/ops/diff-comments"
import { followScrollTop } from "../../tui/panes/filetree/pane-core"
import { RenameTaskDialog } from "../component/rename-task-dialog"
import { useKeymapVersion } from "../context/keybindings"
import { useNotifications } from "../context/notifications"
import { type Theme, useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { useLatest } from "../lib/use-latest"
import { useDialog } from "../ui/dialog"

/** The review chords as the footer names them: the live first chord of each (down/up for the cursor). */
function reviewKeyCaps(): Record<string, string> {
  const first = (id: string, count = 1): string =>
    (findBinding(`diff.review.${id}`)?.keys ?? []).slice(0, count).join("/") || "—"
  return {
    move: first("cursor", 2),
    range: first("range"),
    note: first("note"),
    drop: first("drop"),
    send: first("send"),
    reload: first("reload"),
  }
}

/** The DiffRenderable's scrollable code child, found via the child tree (the direct handle is TS-private). */
function findCodeRenderable(diff: DiffRenderable): CodeRenderable | null {
  const stack = [...diff.getChildren()]
  while (stack.length > 0) {
    const r = stack.pop()
    if (r instanceof CodeRenderable) return r
    if (r) stack.push(...r.getChildren())
  }
  return null
}

function paintColor(kind: ReviewPaintKind, theme: Theme): { gutter: RGBA; content?: RGBA } {
  // No `content` → opentui darkens the gutter color for the row bg.
  if (kind === "cursor") return { gutter: theme.focusAccent, content: theme.backgroundElement }
  if (kind === "range") return { gutter: theme.focusAccent }
  return { gutter: theme.warning }
}

/** Restore built-in diff coloring (as `buildUnifiedView` computes it); `clearLineColor` would strip it. */
function restoreRowColor(diff: DiffRenderable, row: DiffRow | undefined, index: number): void {
  if (!row) {
    diff.clearLineColor(index)
    return
  }
  const config =
    row.kind === "add"
      ? { gutter: diff.addedLineNumberBg, content: diff.addedContentBg ?? diff.addedBg }
      : row.kind === "del"
        ? { gutter: diff.removedLineNumberBg, content: diff.removedContentBg ?? diff.removedBg }
        : { gutter: diff.lineNumberBg, content: diff.contextContentBg ?? diff.contextBg }
  diff.setLineColor(index, config)
}

/** Inert when `review` is absent (standalone `rove ops --preview`) or no diff is showing. */
export function useDiffReview(args: {
  review: DiffReviewApi | undefined
  relPath: string
  /** Lets `send` mark a note whose path the branch no longer has. */
  worktree: string
  diffText: string | null
  focused: boolean
  diffRef: RefObject<DiffRenderable | null>
}): { footer: ReactNode } {
  const dialog = useDialog()
  const { theme } = useTheme()
  const t = useT()
  // The footer names the live chords: re-render when the keymap reloads.
  useKeymapVersion()
  // A refused send must toast: the alternate screen hides the console.
  const notif = useNotifications()

  const rows = useMemo(() => (args.diffText ? unifiedDiffRows(args.diffText) : []), [args.diffText])
  const enabled = args.review != null && rows.length > 0
  const comments = args.review?.comments ?? []

  const [cursor, setCursor] = useState(0)
  const [anchor, setAnchor] = useState<number | null>(null)
  // A different diff is a different row list — reset the cursor/range.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on the diff identity (text + path), not on values the body reads.
  useEffect(() => {
    setCursor(0)
    setAnchor(null)
  }, [args.diffText, args.relPath])

  /* --------- imperative paint + cursor-follow scroll --------- */
  const paintedRef = useRef<ReadonlyMap<number, ReviewPaintKind>>(new Map())
  function paint(): void {
    const diff = args.diffRef.current
    if (!diff) return
    const next = computeReviewPaint(rows, cursor, anchor, comments, args.relPath)
    for (const row of paintedRef.current.keys()) if (!next.has(row)) restoreRowColor(diff, rows[row], row)
    for (const [row, kind] of next) diff.setLineColor(row, paintColor(kind, theme))
    paintedRef.current = next
    const code = findCodeRenderable(diff)
    if (code) {
      const y = followScrollTop(code.scrollY, code.height, cursor)
      if (y != null) code.scrollY = y
    }
  }
  const paintRef = useLatest(paint)
  // biome-ignore lint/correctness/useExhaustiveDependencies: paintRef reads the latest render; the deps are the paint inputs that must trigger a repaint.
  useEffect(() => {
    if (!enabled) return
    paintRef.current()
    // ponytail: the async syntax highlight rebuilds the view and wipes line
    // colors; one delayed repaint covers it, later keystrokes repaint anyway.
    const timer = setTimeout(() => paintRef.current(), 250)
    return () => clearTimeout(timer)
  }, [enabled, rows, cursor, anchor, comments, args.relPath, theme])

  /* --------- note dialog --------- */
  async function promptNote(): Promise<void> {
    const review = args.review
    const range = commentRange(rows, cursor, anchor)
    if (!review || !range) return
    const location =
      range.startLine != null ? `${args.relPath}:${range.startLine}-${range.line}` : `${args.relPath}:${range.line}`
    const body = await RenameTaskDialog.show(dialog, "", {
      dialogTitle: t("ops.preview.review.noteDialogTitle", { location }),
      fieldLabel: t("ops.preview.review.noteFieldLabel"),
      submitLabel: t("ops.preview.review.noteSubmitLabel"),
      placeholder: t("ops.preview.review.notePlaceholder"),
    })
    if (!body) return
    review.add({ filePath: args.relPath, line: range.line, startLine: range.startLine, body })
    setAnchor(null)
  }

  /* --------- bindings (PROPOSED — see file header) --------- */
  const moveCursor = (delta: number): void => {
    if (rows.length === 0) return
    setCursor((c) => Math.max(0, Math.min(c + delta, rows.length - 1)))
  }
  function sendAll(): void {
    const review = args.review
    if (!review) return
    if (review.send(args.worktree)) return
    notif.notify({ kind: "error", taskId: "", tabId: "", title: t("ops.preview.review.sendNoEngine") })
  }

  /** Drop the note the cursor sits inside. */
  function dropNoteAtCursor(): void {
    const note = commentAtRow(rows, cursor, comments, args.relPath)
    if (note) args.review?.remove(note.id)
  }

  useBindings(() => ({
    enabled: enabled && args.focused,
    // Even slots of the cursor chords move down, odd ones up (SLOT_CONTRACTS).
    bindings: bindByIds({
      "diff.review.cursor": (_evt, slot) => moveCursor((slot ?? 0) % 2 === 0 ? 1 : -1),
      "diff.review.range": () => setAnchor((a) => (a == null ? cursor : null)),
      "diff.review.note": () => void promptNote(),
      "diff.review.drop": () => dropNoteAtCursor(),
      "diff.review.send": () => sendAll(),
    }),
  }))

  /* --------- footer --------- */
  const unsent = unsentComments(comments).length
  // Per-file, matching the per-file paint.
  const here = comments.filter((c) => c.filePath === args.relPath).length
  // Opaque background: the diff behind showed through the row's spaces.
  const footer = enabled ? (
    <box
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
      flexShrink={0}
      backgroundColor={theme.background}
    >
      <text fg={unsent > 0 ? theme.warning : theme.textMuted} wrapMode="none">
        {here === comments.length
          ? t("ops.preview.review.count", { total: comments.length, unsent })
          : t("ops.preview.review.countElsewhere", { here, total: comments.length, unsent })}
      </text>
      <text fg={theme.textMuted} wrapMode="none">
        {/* The review chords need this pane focused; opening a diff
            deliberately does not steal focus, so until it has focus the hint
            says how to get there rather than listing keys that do nothing. */}
        {args.focused ? t("ops.preview.review.keysHint", reviewKeyCaps()) : t("ops.preview.review.focusHint")}
      </text>
    </box>
  ) : null
  return { footer }
}
