/**
 * One tooltip for the whole page. Every element's `title` shows as a styled card instead of the
 * browser's own: after a short hover, at once while the pointer moves between tipped controls, and on
 * keyboard focus; never for a finger. Floating UI places it, flipping and shifting it to stay on screen.
 *
 * The `title` moves to `data-tip` on first hover so the browser's card never doubles it; an element
 * left without an accessible name gets the text as `aria-label`. Code that decides itself when a tip
 * shows (the rail's cut-off titles) calls `showTip` / `hideTip` and shares the same card.
 */

import { type Placement, autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom"
import { TIP } from "./ui/tip.ts"

const SHOW_MS = 500
/** A tip opening this soon after the last one closed skips the wait: the user is reading the controls. */
const WARM_MS = 400
const ID = "rove-tip"

let card: HTMLDivElement | null = null
let anchor: HTMLElement | null = null
let stopFollow: (() => void) | null = null
let timer: number | null = null
let closedAt = 0
let keyed = false

/** Whether the latest input was a key: a cursor moved by the mouse has a hover tip of its own. */
export const lastInputWasKey = (): boolean => keyed

function cardEl(): HTMLDivElement {
  if (card?.isConnected) return card
  card = document.createElement("div")
  card.id = ID
  card.setAttribute("role", "tooltip")
  card.className = TIP
  card.hidden = true
  document.body.append(card)
  return card
}

function cancel(): void {
  if (timer !== null) window.clearTimeout(timer)
  timer = null
}

/** Shows `text` beside `el` at once, until `hideTip` or the element leaves the page. */
export function showTip(el: HTMLElement, text: string, placement: Placement = "top"): void {
  cancel()
  hideTip()
  const tip = cardEl()
  tip.textContent = text
  tip.hidden = false
  anchor = el
  el.setAttribute("aria-describedby", ID)
  const place = () => {
    if (!el.isConnected) return hideTip()
    void computePosition(el, tip, {
      strategy: "fixed",
      placement,
      middleware: [offset(6), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      tip.style.left = `${x}px`
      tip.style.top = `${y}px`
    })
  }
  stopFollow = autoUpdate(el, tip, place)
}

export function hideTip(): void {
  cancel()
  if (!anchor) return
  stopFollow?.()
  stopFollow = null
  if (anchor.getAttribute("aria-describedby") === ID) anchor.removeAttribute("aria-describedby")
  anchor = null
  if (card) card.hidden = true
  closedAt = performance.now()
}

/** The tipped element at or above `target`, its `title` taken over. */
function tipped(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const el = target.closest<HTMLElement>("[title], [data-tip]")
  if (!el || el instanceof HTMLIFrameElement) return null
  const title = el.getAttribute("title")
  if (title !== null) {
    el.removeAttribute("title")
    if (title === "") return null
    el.dataset.tip = title
    if (!el.hasAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", title)
  }
  return el.dataset.tip ? el : null
}

function showSoon(el: HTMLElement): void {
  if (el === anchor) return
  cancel()
  const warm = anchor !== null || performance.now() - closedAt < WARM_MS
  const show = () => el.isConnected && el.dataset.tip && showTip(el, el.dataset.tip)
  if (warm) show()
  else timer = window.setTimeout(show, SHOW_MS)
}

let installed = false

/** Takes over every `title` on the page; once, at startup. */
export function installTooltips(): void {
  if (installed) return
  installed = true
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return
    const el = tipped(e.target)
    if (el) showSoon(el)
    // Moving inside a shown tip's anchor (a rail row's title, its glyph) keeps it.
    else if (!(anchor && e.target instanceof Node && anchor.contains(e.target))) hideTip()
  })
  document.addEventListener("pointerout", (e) => {
    const from = tipped(e.target)
    if (from && !(e.relatedTarget instanceof Node && from.contains(e.relatedTarget))) hideTip()
  })
  document.addEventListener(
    "keydown",
    (e) => {
      keyed = true
      if (e.key === "Escape") hideTip()
    },
    true,
  )
  document.addEventListener(
    "pointerdown",
    () => {
      keyed = false
      hideTip()
    },
    true,
  )
  document.addEventListener("focusin", (e) => {
    const el = keyed ? tipped(e.target) : null
    if (el) showSoon(el)
  })
  document.addEventListener("focusout", (e) => {
    if (e.target === anchor) hideTip()
  })
  window.addEventListener("blur", hideTip)
}
