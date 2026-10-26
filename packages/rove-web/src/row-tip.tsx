/**
 * A rail row's full title when the row cuts it off, as Claude's sidebar: a dark card beside the row
 * after a short hover, or after the keyboard cursor rests on it.
 */

import { type PointerEvent, type ReactNode, type RefCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

const SHOW_AFTER_MS = 450

/** Whether the latest input was a key: a cursor moved by the mouse has a hover tip of its own. */
let keyed = false
if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    () => {
      keyed = true
    },
    true,
  )
  document.addEventListener(
    "pointerdown",
    () => {
      keyed = false
    },
    true,
  )
}

const truncated = (row: HTMLElement): boolean => {
  const title = row.querySelector<HTMLElement>(".row-title")
  return !!title && title.scrollWidth > title.clientWidth
}

/** Handlers and ref for the row, and the card to render inside it (portalled to the body). `cursor`: the row is the rail's j/k cursor. */
export function useRowTip(
  text: string,
  cursor: boolean,
): {
  readonly ref: RefCallback<HTMLElement>
  readonly onPointerEnter: (e: PointerEvent<HTMLElement>) => void
  readonly onPointerLeave: () => void
  readonly tip: ReactNode
} {
  const [at, setAt] = useState<DOMRect | null>(null)
  const timer = useRef<number | null>(null)
  const row = useRef<HTMLElement | null>(null)
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const showSoon = (el: HTMLElement) => {
    clear()
    timer.current = window.setTimeout(() => setAt(el.getBoundingClientRect()), SHOW_AFTER_MS)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: the cursor arriving is the trigger; the helpers only touch refs
  useEffect(() => {
    const el = row.current
    const rail = el?.closest<HTMLElement>(".rail")
    if (!cursor || !el || !rail || !keyed || !rail.contains(document.activeElement) || !truncated(el)) return
    const hide = () => {
      clear()
      setAt(null)
    }
    // Focus leaving the rail (to the terminal, a dialog) takes the tip with it.
    const away = (e: FocusEvent) => {
      if (!(e.relatedTarget instanceof Node && rail.contains(e.relatedTarget))) hide()
    }
    showSoon(el)
    rail.addEventListener("focusout", away)
    return () => {
      rail.removeEventListener("focusout", away)
      hide()
    }
  }, [cursor])
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )
  return {
    ref: (el) => {
      row.current = el
    },
    onPointerEnter: (e) => {
      // Only a title the row truncates; a whole one says nothing new. A finger's hold is the row's
      // menu (long-press.ts), and the open task shows its title in full.
      if (e.pointerType === "touch" || !truncated(e.currentTarget)) return
      showSoon(e.currentTarget)
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
