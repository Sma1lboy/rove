/**
 * Scrollback search for the terminal pane: the `/` query row, its keystroke
 * capture, the walk between hits, and the viewport moves both of those need.
 *
 * Its own hook for the reason `use-terminal-selection.ts` is one — it reads
 * the snapshot buffer and paints over it, and nothing else in the pane reads
 * its state. It borrows rather than re-derives: a hit IS a `SelectionRange`,
 * and `overlayMatches` paints it through the same chunk splitter the
 * selection highlight uses.
 *
 * The query is captured with a RAW renderer keypress listener, exactly like
 * the sidebar's `/` (`panes/sidebar/use-tree-search.ts`): this pane has no
 * focusable opentui `<input>` to put a cursor in, and a raw listener
 * registered after the keymap dispatcher never sees a chord that already
 * `preventDefault`ed. What keeps the typed query out of the PTY is separate
 * — `keys.ts` switches the pane's whole passthrough off while `active`.
 *
 * The viewport is moved through `moveViewportScroll`, not by setting an
 * offset, so a jump to a hit is anchored to its absolute line id the same way
 * a `ctrl+pgup` is: output streaming in underneath does not slide the view off
 * the match. `esc` restores the `ViewportScrollState` captured at open for the
 * same reason — an offset would land somewhere else after 200 new lines.
 */

import type { KeyEvent } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { searchQueryKeystroke } from "../../../tui/panes/sidebar/view-core"
import type { TerminalRow } from "../../../tui/panes/terminal/pty"
import type { TerminalSnapshotWindow } from "../../../tui/panes/terminal/pty-types"
import type { Chunk } from "../../../tui/panes/terminal/sgr"
import {
  type ParkedHit,
  findMatches,
  overlayMatches,
  parkHit,
  resolveParkedIndex,
  scrollOffsetForRow,
} from "../../../tui/panes/terminal/terminal-search"
import type { SelectionRange } from "../../../tui/panes/terminal/terminal-selection"
import type { RowWrapFlags } from "../../../tui/panes/terminal/terminal-wrap"
import {
  type ViewportScrollState,
  moveViewportScroll,
  resolveViewportScrollOffset,
} from "../../../tui/panes/terminal/viewport"
import { useTheme } from "../../context/theme"
import { modalActive } from "../../lib/keymap"
import { useLatest } from "../../lib/use-latest"

const NO_MATCHES: readonly SelectionRange[] = []

export interface UseTerminalSearchOpts {
  readonly focused: boolean
  readonly snapshot: readonly TerminalRow[]
  readonly snapshotWindow: TerminalSnapshotWindow | null
  /** Soft-wrap flags parallel to `snapshot`: a needle straddling a wrap point
   *  is in no single row, so the scan runs over logical lines. */
  readonly wrapped: RowWrapFlags
  readonly bodyRows: number
  /** The child owns its own scrollback right now — there is nothing local to walk. */
  readonly onAlternateScreen: boolean
  readonly scrollState: ViewportScrollState
  readonly setScrollState: (next: ViewportScrollState) => void
}

export interface TerminalSearch {
  readonly active: boolean
  readonly query: string
  /** Index into the match list of the hit the viewport is parked on; -1 when none. */
  readonly index: number
  readonly matchCount: number
  /** Open over an app that owns its own buffer — the row shows a note instead of a query. */
  readonly unavailable: boolean
  readonly open: () => void
  readonly close: () => void
  /** +1 walks toward newer output, -1 toward older. Both wrap. */
  readonly step: (delta: 1 | -1) => void
  /** Overlay the visible hits onto a rendered window. Reference-stable per (matches, index, theme). */
  readonly paint: (
    rows: readonly (readonly Chunk[])[],
    firstRow: number,
    width: number,
  ) => readonly (readonly Chunk[])[]
}

export function useTerminalSearch(opts: UseTerminalSearchOpts): TerminalSearch {
  const [active, setActive] = useState(false)
  const [query, setQuery] = useState("")
  // The parked hit is stored by IDENTITY, not by array position — `matches` is
  // rebuilt every PTY frame and a scrollback trim renumbers it. `index` is
  // re-derived from it below, so the counter and the accent highlight name the
  // occurrence the user actually walked to.
  const [parked, setParked] = useState<ParkedHit | null>(null)
  const { theme } = useTheme()
  const optsRef = useLatest(opts)

  // Derived, not stored: a shell that launches `vim` while the row is open
  // must switch to the refusal on that frame, not keep searching one screen
  // of somebody else's redraw.
  const unavailable = active && opts.onAlternateScreen

  // Scanned only while the row is open. The snapshot is replaced on every PTY
  // frame, so an always-on memo would re-walk the whole ring for each line of
  // streaming output — for a query nobody typed.
  const matches = useMemo(
    () => (active && !unavailable ? findMatches(opts.snapshot, query, opts.wrapped) : NO_MATCHES),
    [active, unavailable, opts.snapshot, opts.wrapped, query],
  )
  const matchesRef = useLatest(matches)
  const index = useMemo(
    () => resolveParkedIndex(parked, matches, opts.snapshotWindow),
    [parked, matches, opts.snapshotWindow],
  )
  const indexRef = useLatest(index)

  const jumpToRow = useCallback((row: number): void => {
    const { snapshot, bodyRows, snapshotWindow, scrollState, setScrollState } = optsRef.current
    const target = scrollOffsetForRow(snapshot.length, bodyRows, row)
    const current = resolveViewportScrollOffset(snapshot.length, bodyRows, scrollState, snapshotWindow)
    if (current === target) return
    setScrollState(moveViewportScroll(scrollState, snapshot.length, bodyRows, current - target, snapshotWindow))
  }, [])

  // Bookmarked at open, restored on close. A STATE, not an offset: it carries
  // the epoch + top line, so `esc` lands back on the line you left even when
  // the buffer grew while you searched. A ref, because nothing renders it.
  const bookmarkRef = useRef<ViewportScrollState | null>(null)

  const open = useCallback((): void => {
    bookmarkRef.current = optsRef.current.scrollState
    setQuery("")
    setParked(null)
    setActive(true)
  }, [])

  const close = useCallback((): void => {
    const saved = bookmarkRef.current
    bookmarkRef.current = null
    setActive(false)
    setQuery("")
    setParked(null)
    if (saved) optsRef.current.setScrollState(saved)
  }, [])

  const step = useCallback(
    (delta: 1 | -1): void => {
      const list = matchesRef.current
      if (list.length === 0) return
      // No hit parked yet: `enter` (older) starts at the last, `↓` (newer) at
      // the first — both land on an end of the list rather than nowhere.
      const from = indexRef.current < 0 ? (delta > 0 ? -1 : 0) : indexRef.current
      const next = (((from + delta) % list.length) + list.length) % list.length
      setParked(parkHit(list, next, optsRef.current.snapshotWindow))
      jumpToRow((list[next] as SelectionRange).anchor.row)
    },
    [jumpToRow],
  )

  // A scrollback is read newest-first — the occurrence you want is nearly
  // always the last one — so every new query parks on it and `enter` walks
  // back through history from there. Keyed on the QUERY and not on `matches`:
  // the array is rebuilt on every PTY frame, and re-parking then would yank
  // the viewport off the hit you had walked to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the typed query; `matches` is re-derived per frame and must not re-trigger.
  useEffect(() => {
    if (!active) return
    const last = matches.length - 1
    setParked(parkHit(matches, last, optsRef.current.snapshotWindow))
    if (last >= 0) jumpToRow((matches[last] as SelectionRange).anchor.row)
  }, [active, query])

  const renderer = useRenderer()
  useEffect(() => {
    if (!active || !renderer) return
    const listener = (evt: KeyEvent): void => {
      // Raw listener: it bypasses dispatch, so it honors the dialog overlay's
      // modal barrier itself — same contract as the pane's IME catch-all.
      if (!optsRef.current.focused || modalActive()) return
      setQuery((current) => searchQueryKeystroke(current, evt) ?? current)
    }
    renderer.keyInput.on("keypress", listener)
    return () => {
      renderer.keyInput.off("keypress", listener)
    }
  }, [active, renderer])

  // The current hit paints accent-on-background; the others keep the
  // selection's inverse video. Two inverse blocks would be indistinguishable,
  // and "which one am I on" is the whole point of walking them.
  const hitPaint = useMemo(() => {
    const [ar, ag, ab] = theme.accent.toInts()
    const [br, bg, bb] = theme.background.toInts()
    return { fg: [br, bg, bb] as const, bg: [ar, ag, ab] as const }
  }, [theme])

  const paint = useCallback(
    (rows: readonly (readonly Chunk[])[], firstRow: number, width: number) =>
      overlayMatches(rows, matches, index, firstRow, width, hitPaint),
    [matches, index, hitPaint],
  )

  return { active, query, index, matchCount: matches.length, unavailable, open, close, step, paint }
}
