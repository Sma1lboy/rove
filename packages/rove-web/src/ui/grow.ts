import { type Ref, type RefCallback, useCallback, useLayoutEffect, useRef } from "react"

/**
 * Worn by a field `useGrow` sizes: it stops at `--field-max` (tailwind.css) and scrolls inside. Height is the one
 * property animated here that is not a transform: the text has to reflow.
 */
export const GROW = "max-h-(--field-max) transition-[height] duration-140 ease-snap motion-reduce:transition-none"
/** `GROW`'s duration: a field that is swapped out once emptied waits this long, so it shrinks before it goes. */
export const GROW_MS = 140

/**
 * Sizes `el` to its text, between its CSS min and max height, easing from the height it had. Measured by hand so it
 * also works where `field-sizing: content` does not.
 */
function fit(el: HTMLTextAreaElement, animate: boolean): void {
  const s = el.style
  // Not laid out (the touch-only bar on a desktop): nothing to measure, and no stale height to keep.
  if (!el.offsetParent) return void s.removeProperty("height")
  const from = el.offsetHeight
  const top = el.getBoundingClientRect().top
  const scroll = el.scrollTop
  s.transition = "none"
  s.height = "auto"
  const edges = el.offsetHeight - el.clientHeight
  s.height = `${Math.max(el.getBoundingClientRect().height, el.scrollHeight + edges)}px`
  const to = el.offsetHeight
  const capped = el.scrollHeight > el.clientHeight + 1
  // Below the cap nothing scrolls, so no scrollbar flashes while the box is still catching up with its text.
  s.overflowY = capped ? "" : "hidden"
  // A field pinned by its bottom edge grows upward: it keeps the browser's scroll to the caret, so the text
  // stands still on screen and the first line slides in. One pinned by its top shows its text from the top.
  const rises = Math.abs(el.getBoundingClientRect().top - top) > 0.5
  if (animate && to !== from) {
    s.height = `${from}px`
    el.scrollTop = rises || capped ? scroll : 0
    void el.offsetHeight
    s.transition = ""
    s.height = `${to}px`
    return
  }
  s.transition = ""
  el.scrollTop = scroll
}

/**
 * Makes a `<textarea>` grow a line at a time with its text and shrink back, with one short height animation, then
 * scroll inside once it reaches its `max-h`. Returns the field's `ref`; `ref` is the caller's own, if it has one.
 * The field wears `GROW`.
 */
export function useGrow(value: string, ref?: Ref<HTMLTextAreaElement>): RefCallback<HTMLTextAreaElement> {
  const own = useRef<HTMLTextAreaElement | null>(null)
  const shown = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the text is what changes the height.
  useLayoutEffect(() => {
    // ponytail: refits on text only; a width change (rotation) waits for the next keystroke. ResizeObserver if it shows.
    if (own.current) fit(own.current, shown.current)
    shown.current = true
  }, [value])
  const held = useRef(ref)
  held.current = ref
  return useCallback((el) => {
    own.current = el
    const outer = held.current
    if (typeof outer === "function") outer(el)
    else if (outer) outer.current = el
  }, [])
}
