/**
 * Scrollbars show only while their element scrolls (tailwind.css): the element that moved wears
 * `data-scrolling` until it has rested for a moment.
 */

const REST_MS = 900
const timers = new WeakMap<Element, number>()

/** Show `el`'s scrollbar now and hide it once it rests. */
export function markScrolling(el: Element): void {
  el.setAttribute("data-scrolling", "")
  window.clearTimeout(timers.get(el))
  timers.set(
    el,
    window.setTimeout(() => el.removeAttribute("data-scrolling"), REST_MS),
  )
}

/** Every native scroll, captured at the document, marks the element that moved. */
export function revealScrollbarsOnScroll(): void {
  document.addEventListener(
    "scroll",
    (event) => {
      const el = event.target instanceof Element ? event.target : document.scrollingElement
      if (el) markScrolling(el)
    },
    { capture: true, passive: true },
  )
}
