/** @jsxImportSource @opentui/react */
/**
 * Diff review overlay for the read-only preview tab (`PreviewScreen`) — a
 * line cursor over the unified `<diff>`, range select, a note dialog (the
 * shared RenameTaskDialog text prompt, per the reuse-original-dialogs rule),
 * and the send-all action. All pure logic (row mapping, paint set, range
 * math, the kv-backed store) is `src/tui/ops/diff-comments.ts`; this file
 * owns only React state, key bindings, and imperative paint/scroll on the
 * DiffRenderable.
 *
 * PROPOSED chords (owner sign-off pending, see docs/KEYBINDINGS.md rules):
 * j/k/down/up line cursor · v range anchor · c note · s send-all · x drop the
 * note under the cursor. Plain letters, active only while the diff content tab
 * has workspace focus — same raw-binding precedent as this screen's existing
 * `o` (system open). `x` is the NEW one in this set.
 */

import type { DiffRenderable, RGBA } from "@opentui/core"
import { CodeRenderable } from "@opentui/core"
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react"
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
import { useNotifications } from "../context/notifications"
import { type Theme, useTheme } from "../context/theme"
import { useT } from "../i18n"
import { useBindings } from "../lib/keymap"
import { useLatest } from "../lib/use-latest"
import { useDialog } from "../ui/dialog"

/** The scrollable code child inside the DiffRenderable's unified side —
 * reached via the public child tree (the direct handle is TS-private). */
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

/** Restore a vacated row to the built-in diff coloring (the same config
 * `buildUnifiedView` computes) — `clearLineColor` would strip it instead. */
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

/**
 * Wire the review overlay into a mounted `<diff>`. Inert (no bindings, no
 * footer) when `review` is absent (standalone `kobe ops --preview`) or the
 * preview isn't showing a diff.
 */
export function useDiffReview(args: {
  review: DiffReviewApi | undefined
  relPath: string
  /** Worktree root — passed to `send` so the prompt can mark a note whose
   *  path the branch no longer has. */
  worktree: string
  diffText: string | null
  focused: boolean
  diffRef: RefObject<DiffRenderable | null>
}): { footer: ReactNode } {
  const dialog = useDialog()
  const { theme } = useTheme()
  const t = useT()
  // A refused send has to say so out loud: under an alternate screen there is
  // no console to read, and the footer count staying put is exactly what the
  // silent-drop bug looked like. Same empty taskId/tabId pattern as the rail
  // pages — only the toast queue is consumed here.
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
    // ponytail: the DiffRenderable rebuilds its view once the async syntax
    // highlight lands, wiping custom line colors — one delayed repaint
    // covers it; any later keystroke repaints anyway.
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

  /** `x` — drop the note the cursor sits inside. PROPOSED chord. */
  function dropNoteAtCursor(): void {
    const note = commentAtRow(rows, cursor, comments, args.relPath)
    if (note) args.review?.remove(note.id)
  }

  useBindings(() => ({
    enabled: enabled && args.focused,
    bindings: [
      // The `id`s mirror the doc-only `diff.review.*` rows in KobeKeymap. The
      // chords stay literal here (FIXED_BINDING_IDS rejects overrides for
      // them) — the id is what puts the rows in the reachability scan, so F1
      // lists them only while a diff with rows is actually focused.
      { key: "j", id: "diff.review.cursor", cmd: () => moveCursor(1) },
      { key: "down", id: "diff.review.cursor", cmd: () => moveCursor(1) },
      { key: "k", id: "diff.review.cursor", cmd: () => moveCursor(-1) },
      { key: "up", id: "diff.review.cursor", cmd: () => moveCursor(-1) },
      { key: "v", id: "diff.review.range", cmd: () => setAnchor((a) => (a == null ? cursor : null)) },
      { key: "c", id: "diff.review.note", cmd: () => void promptNote() },
      { key: "x", id: "diff.review.drop", cmd: () => dropNoteAtCursor() },
      { key: "s", id: "diff.review.send", cmd: () => sendAll() },
    ],
  }))

  /* --------- footer --------- */
  const unsent = unsentComments(comments).length
  // Per-file, because the paint is per-file: a footer counting the whole
  // task claimed notes on a file that has none and shows none.
  const here = comments.filter((c) => c.filePath === args.relPath).length
  // Opaque background: the row is mostly spaces, and a diff drawn behind it
  // showed through them — `0 notes · 0 unsent` arrived as `06notesn· 06unsent`
  // with the diff's next line bleeding through every gap.
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
        {args.focused ? t("ops.preview.review.keysHint") : t("ops.preview.review.focusHint")}
      </text>
    </box>
  ) : null
  return { footer }
}
