/**
 * A rail row's full title when the row cuts it off, as Claude's sidebar: the page's tooltip card beside
 * the row after a short hover, or after the keyboard cursor rests on it.
 */

import { type PointerEvent, type RefCallback, useEffect, useRef } from "react"
import { hideTip, lastInputWasKey, showTip } from "./tooltip.ts"

const SHOW_AFTER_MS = 450

const truncated = (row: HTMLElement): boolean => {
  const title = row.querySelector<HTMLElement>(".row-title")
  return !!title && title.scrollWidth > title.clientWidth
}

/** Handlers and ref for the row. `cursor`: the row is the rail's j/k cursor. */
export function useRowTip(
  text: string,
  cursor: boolean,
): {
  readonly ref: RefCallback<HTMLElement>
  readonly onPointerEnter: (e: PointerEvent<HTMLElement>) => void
  readonly onPointerLeave: () => void
  /** Drop the card and any pending one, for another card opening over the same spot (the PR list). */
  readonly hide: () => void
} {
  const timer = useRef<number | null>(null)
  const row = useRef<HTMLElement | null>(null)
  const latest = useRef(text)
  latest.current = text
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const showSoon = (el: HTMLElement) => {
    clear()
    timer.current = window.setTimeout(() => showTip(el, latest.current, "right"), SHOW_AFTER_MS)
  }
  const dismiss = () => {
    clear()
    hideTip()
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: the cursor arriving is the trigger; the helpers only touch refs
  useEffect(() => {
    const el = row.current
    const rail = el?.closest<HTMLElement>(".rail")
    if (!cursor || !el || !rail || !lastInputWasKey() || !rail.contains(document.activeElement) || !truncated(el))
      return
    // Focus leaving the rail (to the terminal, a dialog) takes the tip with it.
    const away = (e: FocusEvent) => {
      if (!(e.relatedTarget instanceof Node && rail.contains(e.relatedTarget))) dismiss()
    }
    showSoon(el)
    rail.addEventListener("focusout", away)
    return () => {
      rail.removeEventListener("focusout", away)
      dismiss()
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
    onPointerLeave: dismiss,
    hide: dismiss,
  }
}
