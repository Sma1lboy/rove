/**
 * When the task list changes under the rail (a row archived, pinned, deleted, a new one listed),
 * the rows that stay slide to their new place and a new row fades in. Only a change of the list
 * itself moves anything: typing in search or folding a project redraws at once.
 */

import { useLayoutEffect, useRef } from "react"

const SLIDE = { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" } as const

/** `list` is the task list's identity; `hold` is true while something else (a drag) places the rows. */
export function useRowSlide(list: unknown, hold: boolean): void {
  const last = useRef<{ list: unknown; tops: Map<string, number> } | null>(null)
  useLayoutEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>("[data-rail-body] > [data-row]")]
    // offsetTop ignores both the scroll position and a transform still playing.
    const tops = new Map(els.map((el) => [el.dataset.row ?? "", el.offsetTop]))
    const before = last.current
    last.current = { list, tops }
    if (!before || before.list === list || before.tops.size === 0 || hold) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    for (const el of els) {
      const was = before.tops.get(el.dataset.row ?? "")
      if (was === undefined) el.animate([{ opacity: 0 }, { opacity: 1 }], SLIDE)
      else if (was !== el.offsetTop) {
        el.animate([{ transform: `translateY(${was - el.offsetTop}px)` }, { transform: "none" }], SLIDE)
      }
    }
  })
}
