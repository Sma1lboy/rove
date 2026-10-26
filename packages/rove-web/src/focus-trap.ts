/** Tab and Shift+Tab wrap inside the open dialog, so the keyboard never walks out to the page behind its scrim. */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Tab stops only: a `tabIndex=-1` chip or row is reached by arrows, never by Tab. */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && el.offsetParent !== null)
}

export function trapDialogFocus(): void {
  // Bubble phase: a dialog's own Tab (field cycles, completion) runs first and prevents the default.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
    const overlay = [...document.querySelectorAll<HTMLElement>(".overlay:not(.is-leaving)")].at(-1)
    if (!overlay) return
    const stops = focusables(overlay)
    if (stops.length === 0) return
    // From wherever focus is (a stop, a -1 chip, the dialog itself, outside), the next stop in DOM order, wrapping.
    const active = document.activeElement
    const inside = active instanceof HTMLElement && overlay.contains(active)
    const after = (el: HTMLElement) =>
      inside && !!(active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
    const before = (el: HTMLElement) =>
      inside && !!(active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)
    const next = e.shiftKey ? (stops.filter(before).at(-1) ?? stops.at(-1)) : (stops.find(after) ?? stops[0])
    e.preventDefault()
    next?.focus()
  })
}
