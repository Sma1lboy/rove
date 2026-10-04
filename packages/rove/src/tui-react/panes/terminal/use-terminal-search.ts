/**
 * Scrollback search for the terminal pane. A hit IS a `SelectionRange`,
 * painted through the selection's chunk splitter.
 *
 * The query is captured by a RAW keypress listener (no focusable `<input>`
 * here); it never sees a chord the dispatcher already `preventDefault`ed.
 * `keys.ts` keeps the query out of the PTY by switching passthrough off.
 *
 * Moves go through `moveViewportScroll`, anchored to absolute line ids, so
 * streaming output doesn't slide the view off a match; `esc` restores the
 * `ViewportScrollState` captured at open for the same reason.
 */

import { type KeyEvent, type PasteEvent, decodePasteBytes } from "@opentui/core"
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
  /** Reference-stable per (matches, index, theme). */
  readonly paint: (
    rows: readonly (readonly Chunk[])[],
    firstRow: number,
    width: number,
  ) => readonly (readonly Chunk[])[]
}

export function useTerminalSearch(opts: UseTerminalSearchOpts): TerminalSearch {
  const [active, setActive] = useState(false)
  const [query, setQuery] = useState("")
  // Parked hit by IDENTITY: `matches` is rebuilt every frame and a trim renumbers it.
  const [parked, setParked] = useState<ParkedHit | null>(null)
  const { theme } = useTheme()
  const optsRef = useLatest(opts)

  // Derived, not stored: launching `vim` mid-search must switch to the refusal that frame.
  const unavailable = active && opts.onAlternateScreen

  // Only while open: the snapshot changes every frame, so an always-on scan re-walks the ring.
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

  // A STATE (epoch + top line), not an offset, so `esc` survives buffer growth.
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
      // Nothing parked: older starts at the last hit, newer at the first.
      const from = indexRef.current < 0 ? (delta > 0 ? -1 : 0) : indexRef.current
      const next = (((from + delta) % list.length) + list.length) % list.length
      setParked(parkHit(list, next, optsRef.current.snapshotWindow))
      jumpToRow((list[next] as SelectionRange).anchor.row)
    },
    [jumpToRow],
  )

  // Each new query parks on the newest hit. Keyed on the QUERY, not `matches`
  // (rebuilt every frame), or the viewport would be yanked off a walked hit.
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
      // Raw listener bypasses dispatch, so it honors the modal barrier itself.
      if (!optsRef.current.focused || modalActive()) return
      setQuery((current) => searchQueryKeystroke(current, evt) ?? current)
    }
    const paste = (evt: PasteEvent): void => {
      if (evt.defaultPrevented || !optsRef.current.focused || modalActive()) return
      const text = decodePasteBytes(evt.bytes).replace(/[\r\n]+/g, " ")
      setQuery((current) => current + text)
      evt.preventDefault()
    }
    renderer.keyInput.on("keypress", listener)
    renderer.keyInput.on("paste", paste)
    return () => {
      renderer.keyInput.off("keypress", listener)
      renderer.keyInput.off("paste", paste)
    }
  }, [active, renderer])

  // The current hit is accent, the rest inverse, so "which one am I on" is visible.
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
