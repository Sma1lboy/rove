/**
 * The page fits the visible viewport, not the layout one: iOS Safari keeps the layout viewport when the
 * soft keyboard opens, which left the terminal's input line and key row under the keyboard.
 */
export function followVisualViewport(): void {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement
  const sync = () => {
    // Pinch zoom shrinks the visual viewport too; scaled back, only the keyboard takes height away.
    root.style.setProperty("--vvh", `${vv.height * vv.scale}px`)
    // iOS scrolls the layout viewport to show the focused field; the page already fits, so undo it.
    if (vv.scale === 1 && window.scrollY !== 0) window.scrollTo(0, 0)
  }
  vv.addEventListener("resize", sync)
  vv.addEventListener("scroll", sync)
  sync()
}
