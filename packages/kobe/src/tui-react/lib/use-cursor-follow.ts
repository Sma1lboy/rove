/**
 * Keep a list page's cursor row inside its scroll viewport.
 *
 * The mechanism is the one `panes/sidebar/SidebarTree.tsx` already uses — a
 * Map of row renderables plus `scrollChildIntoView` on the owning scrollbox —
 * lifted out because four rail pages need it and rows there are NOT uniform
 * height (worktree rows are 2 lines, routine strips 3, kanban cards vary), so
 * `filetree/pane-core.ts`'s `followScrollTop` arithmetic does not apply.
 *
 * `scrollRef` may be attached to more than one scrollbox: `scrollChildIntoView`
 * resolves the row through `findDescendantById` and silently no-ops on a
 * container that does not hold it, so the kanban board can register all four
 * lanes and only the lane owning the selected card scrolls.
 */

import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useRef } from "react"

export type CursorFollow<K> = {
  /** `ref` for a scrollbox holding cursor rows. */
  scrollRef: (r: ScrollBoxRenderable | null) => (() => void) | undefined
  /** `ref` for one row, keyed the same way the cursor is. */
  rowRef: (key: K) => (r: BoxRenderable | null) => (() => void) | undefined
}

export function useCursorFollow<K>(cursor: K): CursorFollow<K> {
  const scrolls = useRef<Set<ScrollBoxRenderable>>(new Set())
  const rows = useRef<Map<K, BoxRenderable>>(new Map())

  useEffect(() => {
    const el = rows.current.get(cursor)
    if (!el) return
    for (const scroll of scrolls.current) {
      if (scroll.viewport.height > 0) scroll.scrollChildIntoView(el.id)
    }
  }, [cursor])

  return {
    scrollRef: (r) => {
      if (!r) return undefined
      scrolls.current.add(r)
      return () => {
        scrolls.current.delete(r)
      }
    },
    rowRef: (key) => (r) => {
      if (!r) return undefined
      rows.current.set(key, r)
      return () => {
        if (rows.current.get(key) === r) rows.current.delete(key)
      }
    },
  }
}
