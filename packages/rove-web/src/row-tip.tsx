/** A rail row's full title when the row cuts it off, as Claude's sidebar: a dark card beside the row after a short hover. */

import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

const SHOW_AFTER_MS = 450

/** Handlers for the row, and the card to render inside it (portalled to the body). */
export function useRowTip(text: string): {
  readonly onPointerEnter: (e: PointerEvent<HTMLElement>) => void
  readonly onPointerLeave: () => void
  readonly tip: ReactNode
} {
  const [at, setAt] = useState<DOMRect | null>(null)
  const timer = useRef<number | null>(null)
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )
  return {
    onPointerEnter: (e) => {
      const row = e.currentTarget
      const title = row.querySelector<HTMLElement>(".row-title")
      // Only a title the row truncates; a whole one says nothing new. A finger's hold is the row's
      // menu (long-press.ts), and the open task shows its title in full.
      if (e.pointerType === "touch" || !title || title.scrollWidth <= title.clientWidth) return
      clear()
      timer.current = window.setTimeout(() => setAt(row.getBoundingClientRect()), SHOW_AFTER_MS)
    },
    onPointerLeave: () => {
      clear()
      setAt(null)
    },
    tip: at
      ? createPortal(
          <div className="row-tip" role="tooltip" style={{ top: at.top + at.height / 2, left: at.right + 8 }}>
            {text}
          </div>,
          document.body,
        )
      : null,
  }
}
