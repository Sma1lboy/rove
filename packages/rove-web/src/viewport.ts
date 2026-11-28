/**
 * The page fits the visible viewport, not the layout one: iOS Safari keeps the layout viewport when the
 * soft keyboard opens, which left the terminal's input line and key row under the keyboard.
 */
export function followVisualViewport(): void {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement
  const KEYBOARD_PX = 120
  // On touch, against the tallest the page has been at this width. Not `innerHeight`: a WKWebView shrinks it to
  // the visible height while the keyboard rises and grows it back with no event, which read as no keyboard and put
  // the home-indicator padding back under the key row. A desktop window made shorter is not a keyboard.
  // ponytail: a touch window resized shorter at the same width (iPad Stage Manager) reads as a keyboard.
  const touch = window.matchMedia("(pointer: coarse)")
  let tallest = 0
  let width = 0
  const sync = () => {
    const visible = vv.height * vv.scale
    if (window.innerWidth !== width) {
      width = window.innerWidth
      tallest = 0
    }
    tallest = touch.matches ? Math.max(tallest, visible, window.innerHeight) : window.innerHeight
    // iOS keeps the layout viewport under the keyboard, so a much shorter visual one is the keyboard.
    const keyboard = tallest - visible > KEYBOARD_PX
    const moved = keyboard !== root.hasAttribute("data-keyboard")
    // A dialog jumps with the keyboard (overlay.ts): measured before and after, it glides the difference instead.
    const dialog = moved ? document.querySelector<HTMLElement>(".overlay:not(.is-leaving) .dialog") : null
    const from = dialog?.getBoundingClientRect().top
    // Pinch zoom shrinks the visual viewport too; scaled back, only the keyboard takes height away.
    root.style.setProperty("--vvh", `${visible}px`)
    root.toggleAttribute("data-keyboard", keyboard)
    if (dialog && from !== undefined && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const dy = from - dialog.getBoundingClientRect().top
      if (dy)
        dialog.animate({ translate: [`0 ${dy}px`, "0 0"] }, { duration: 240, easing: "cubic-bezier(0.2, 0, 0, 1)" })
    }
    // iOS scrolls the layout viewport to show the focused field; the page already fits, so undo it.
    if (vv.scale === 1 && window.scrollY !== 0) window.scrollTo(0, 0)
  }
  vv.addEventListener("resize", sync)
  vv.addEventListener("scroll", sync)
  // A layout-viewport scroll after the keyboard settles fires no visualViewport event.
  window.addEventListener("scroll", sync, { passive: true })
  sync()
}
