/**
 * A touch long-press opens the same menu a right click does. iOS Safari never fires `contextmenu`
 * on a long-press, so the page sends one itself to the pressed element; every `onContextMenu`
 * (rail rows, project headers, tabs) gets a touch path without knowing about it.
 */

const HOLD_MS = 500
/** A finger drifting further than this is a scroll, not a press. */
const SLOP_PX = 10
/** Text fields keep the system's own long-press (select, paste); the terminal keeps xterm's. */
const NATIVE = "input, textarea, select, [contenteditable], .xterm"

export function longPressOpensMenus(): void {
  let press: { timer: number; x: number; y: number; native: boolean } | null = null
  const cancel = () => {
    if (press) window.clearTimeout(press.timer)
    press = null
  }
  // The tap that ends a long-press must not also open the row; the next press forgets it.
  const swallowClick = () => {
    const swallow = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      forget()
    }
    const forget = () => {
      document.removeEventListener("click", swallow, true)
      document.removeEventListener("pointerdown", forget, true)
    }
    document.addEventListener("click", swallow, true)
    document.addEventListener("pointerdown", forget, true)
  }
  document.addEventListener(
    "pointerdown",
    (e) => {
      cancel()
      if (e.pointerType !== "touch" || !(e.target instanceof Element) || e.target.closest(NATIVE)) return
      const target = e.target
      const state = {
        x: e.clientX,
        y: e.clientY,
        native: false,
        timer: window.setTimeout(() => {
          press = null
          // Android fires its own contextmenu on a long-press; one menu is enough.
          if (state.native) return
          target.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: state.x,
              clientY: state.y,
              button: 2,
            }),
          )
          swallowClick()
        }, HOLD_MS),
      }
      press = state
    },
    true,
  )
  document.addEventListener(
    "pointermove",
    (e) => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP_PX) cancel()
    },
    true,
  )
  document.addEventListener("pointerup", cancel, true)
  document.addEventListener("pointercancel", cancel, true)
  document.addEventListener(
    "contextmenu",
    (e) => {
      if (press && e.isTrusted) press.native = true
    },
    true,
  )
}
