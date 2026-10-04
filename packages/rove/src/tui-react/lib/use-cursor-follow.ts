/**
 * Keep a list page's cursor row in view via `scrollChildIntoView`; rows are
 * not uniform height, so offset arithmetic doesn't apply. `scrollRef` may be
 * attached to several scrollboxes: one that doesn't hold the row no-ops, so
 * only the kanban lane owning the card scrolls.
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
