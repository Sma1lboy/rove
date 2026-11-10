/**
 * Overlays fade out as a DOM copy: the React tree (its effects, its window key listeners) goes at once,
 * so a closing dialog can't eat the next key or fire twice; only its pixels linger for the fade.
 */

import { hud } from "./prefix-state.ts"
import { LEAVE_MS, dialog, menu, reducedMotion } from "./ui.ts"

/** Copies every `selector` match still on screen into an inert `is-leaving` ghost; the CSS fades it. */
function leaveCopies(selector: string): void {
  if (reducedMotion()) return
  for (const el of document.querySelectorAll<HTMLElement>(`${selector}:not(.is-leaving)`)) {
    const ghost = el.cloneNode(true) as HTMLElement
    ghost.classList.add("is-leaving")
    ghost.inert = true
    ghost.setAttribute("aria-hidden", "true")
    document.body.append(ghost)
    // A clone starts unscrolled and without typed text; the fade should show what was there.
    const from = el.querySelectorAll<HTMLElement>("*")
    const to = ghost.querySelectorAll<HTMLElement>("*")
    from.forEach((node, i) => {
      const copy = to[i]
      if (node.scrollTop) copy.scrollTop = node.scrollTop
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        ;(copy as HTMLInputElement | HTMLTextAreaElement).value = node.value
      }
    })
    window.setTimeout(() => ghost.remove(), LEAVE_MS + 60)
  }
}

function dropGhosts(selector: string): void {
  for (const el of document.querySelectorAll(`${selector}.is-leaving`)) el.remove()
}

function finishScrimFade(): void {
  for (const el of document.querySelectorAll<HTMLElement>(".overlay:not(.is-leaving)")) {
    for (const a of el.getAnimations()) if (a instanceof CSSAnimation && a.animationName === "fade-in") a.finish()
  }
}

/** Subscribed before React's own listeners (module order), so the old DOM is still there to copy. */
export function watchLeaving(): void {
  let lastDialog = dialog.get()
  let closedAt = Number.NEGATIVE_INFINITY
  dialog.subscribe(() => {
    const next = dialog.get()
    if (next === null && lastDialog !== null) {
      closedAt = performance.now()
      leaveCopies(".overlay")
    } else if (next !== null) {
      // A dialog replacing another (directly, or the palette closing then running one) keeps the scrim.
      const swap = lastDialog !== null || performance.now() - closedAt < LEAVE_MS
      dropGhosts(".overlay")
      if (swap) requestAnimationFrame(finishScrimFade)
    }
    lastDialog = next
  })
  let lastMenu = menu.get()
  menu.subscribe(() => {
    const next = menu.get()
    if (next === null && lastMenu !== null) leaveCopies(".menu")
    else if (next !== null) dropGhosts(".menu")
    lastMenu = next
  })
  let lastGuide = hud.get().guide
  hud.subscribe(() => {
    const next = hud.get().guide
    if (next === null && lastGuide !== null) leaveCopies(".prefix-guide")
    else if (next !== null) dropGhosts(".prefix-guide")
    lastGuide = next
  })
}
