/**
 * A dialog's own Tab order, for the places where the TUI's Tab walks named fields rather than the
 * browser's DOM order. A stop is a `data-field` name: an input or textarea, or a chip row (its
 * active chip takes focus).
 */

function focusStop(root: HTMLElement, field: string): void {
  const el = root.querySelector<HTMLElement>(`[data-field="${field}"]`)
  const target = el?.matches("input, textarea") ? el : el?.querySelector<HTMLElement>("[tabindex='0']")
  target?.focus()
}

/** Move focus `dir` stops on from the focused field (wrapping); from outside the cycle, to the first. */
export function cycleStop(root: HTMLElement, stops: readonly string[], dir: 1 | -1): void {
  const here = document.activeElement?.closest("[data-field]")?.getAttribute("data-field")
  const at = stops.findIndex((stop) => stop === here)
  const next = at < 0 ? 0 : (at + dir + stops.length) % stops.length
  const stop = stops[next]
  if (stop) focusStop(root, stop)
}
