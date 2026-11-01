/**
 * Scrollback search (TUI `terminal.search`, prefix `/` in the terminal): a query row
 * over the bottom of the pane, `/ query█ 3/17`. A new query parks on the newest hit,
 * Enter / ↑ walk to older, ↓ to newer, Esc closes and puts the viewport back where it
 * was. The alternate screen has no local scrollback, so there it refuses, as the TUI.
 */

import { useEffect, useRef, useState } from "react"
import { terminalText } from "./keymap-text.ts"
import type { TermHandle } from "./term-mount.ts"
import { TERM_SEARCH, TERM_SEARCH_INPUT } from "./ui/shell.ts"

/** Hits: the others inverse, the current one accent (`useTerminalSearch`'s `hitPaint`). */
const DECORATIONS = {
  matchBackground: "#a9a39a",
  matchOverviewRuler: "#a9a39a",
  activeMatchBackground: "#cc785c",
  activeMatchColorOverviewRuler: "#cc785c",
} as const

export function TermSearchBar({ handle, onClose }: { handle: TermHandle; onClose: () => void }) {
  const { term, search } = handle
  const bookmark = useRef(term.buffer.active.viewportY)
  const unavailable = term.buffer.active.type === "alternate"
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState({ index: -1, total: 0 })

  useEffect(() => {
    const sub = search.onDidChangeResults(({ resultIndex, resultCount }) =>
      setHits({ index: resultIndex, total: resultCount }),
    )
    return () => {
      sub.dispose()
      search.clearDecorations()
    }
  }, [search])

  // Each new query parks on the newest hit: search backwards from the end of the buffer.
  useEffect(() => {
    if (unavailable) return
    term.clearSelection()
    if (query.length === 0) {
      search.clearDecorations()
      setHits({ index: -1, total: 0 })
      return
    }
    search.findPrevious(query, { decorations: DECORATIONS })
  }, [query, unavailable, search, term])

  const close = () => {
    search.clearDecorations()
    term.clearSelection()
    term.scrollToLine(bookmark.current)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close()
    else if (unavailable) return
    else if (e.key === "Enter" || e.key === "ArrowUp") search.findPrevious(query, { decorations: DECORATIONS })
    else if (e.key === "ArrowDown") search.findNext(query, { decorations: DECORATIONS })
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const status =
    query.length === 0
      ? terminalText("search.placeholder")
      : hits.total === 0
        ? terminalText("search.noMatches")
        : terminalText("search.position", { index: hits.index < 0 ? "?" : hits.index + 1, total: hits.total })

  return (
    <div className={`mono ${TERM_SEARCH}`}>
      {unavailable ? (
        <span className="text-warning">{terminalText("search.unavailable")}</span>
      ) : (
        <>
          <span className="text-accent">/</span>
          <input
            className={TERM_SEARCH_INPUT}
            // biome-ignore lint/a11y/noAutofocus: the query row is the only thing to type into
            autoFocus
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <span className="text-muted">{status}</span>
        </>
      )}
      {unavailable && (
        <input
          className={`is-hidden ${TERM_SEARCH_INPUT}`}
          // biome-ignore lint/a11y/noAutofocus: takes Esc for the refusal row
          autoFocus
          readOnly
          onKeyDown={onKeyDown}
          aria-label={terminalText("search.unavailable")}
        />
      )}
    </div>
  )
}
