/**
 * The hero's sky: the web client's welcome plate (packages/rove/src/lib/celestial), as a backdrop
 * that spans the page behind the headline.
 * The scenes are the app's own frame functions; this file only paints their cells on a canvas in
 * the page's tokens. Built to celestial.js by `bun run build:celestial`; edit here, not there.
 */
import { ACCENT, COLS, ROWS, SUBTLE } from "../rove/src/lib/celestial/grid.ts"
import { orbitFrame } from "../rove/src/lib/celestial/orbit.ts"
import { cometFrame, ringsFrame } from "../rove/src/lib/celestial/scenes.ts"

// A backdrop: wide grain, small dots, and inks one step quieter than the app's so text reads over it.
const PITCH = 10
const DOT = 4
const TOKEN = ["", "--rule", "--rule", "--ink-3", "--accent"]
/** How strongly each ink is laid down: the brightest cells stay well under the text's own weight. */
const ALPHA = [0, 0.7, 1, 0.4, 0.75]
const SCENES = [ringsFrame, cometFrame, orbitFrame]
/** Seconds a scene holds before the next fades in. */
const HOLD = 22
/** The moment a still plate shows, for reduced motion. */
const STILL_T = 7

const canvas = document.getElementById("sky") as HTMLCanvasElement | null
const ctx = canvas?.getContext("2d")
if (canvas && ctx) {
  const cells = new Uint8Array(COLS * ROWS)
  const motion = matchMedia("(prefers-reduced-motion: reduce)")
  let scene = 0
  let elapsed = STILL_T
  let last = 0
  let timer = 0
  let visible = false

  const draw = () => {
    ;(SCENES[scene] ?? ringsFrame)(cells, motion.matches ? STILL_T : elapsed)
    const dpr = window.devicePixelRatio || 1
    const width = Math.round(COLS * PITCH * dpr)
    if (canvas.width !== width) {
      canvas.width = width
      canvas.height = Math.round(ROWS * PITCH * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, COLS * PITCH, ROWS * PITCH)
    // Tokens are read per frame so a theme switch repaints in the new palette.
    const style = getComputedStyle(canvas)
    for (let ink = SUBTLE; ink <= ACCENT; ink++) {
      ctx.fillStyle = style.getPropertyValue(TOKEN[ink] ?? "") || style.color
      ctx.globalAlpha = ALPHA[ink] ?? 1
      for (let i = 0; i < cells.length; i++)
        if (cells[i] === ink) ctx.fillRect((i % COLS) * PITCH, Math.floor(i / COLS) * PITCH, DOT, DOT)
    }
  }
  const tick = (now: number) => {
    timer = requestAnimationFrame(tick)
    if (now - last < 1000 / 24) return
    elapsed += (now - last) / 1000
    last = now
    draw()
  }
  const sync = () => {
    cancelAnimationFrame(timer)
    if (!visible || document.hidden) return
    draw()
    if (!motion.matches) {
      last = performance.now()
      timer = requestAnimationFrame(tick)
    }
  }
  new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting
    sync()
  }).observe(canvas)
  motion.addEventListener("change", sync)
  document.addEventListener("visibilitychange", sync)
  // The next scene swaps in while the canvas is faded out (the .is-out transition in base.css).
  setInterval(() => {
    if (!visible || document.hidden || motion.matches) return
    canvas.classList.add("is-out")
    setTimeout(() => {
      scene = (scene + 1) % SCENES.length
      draw()
      canvas.classList.remove("is-out")
    }, 600)
  }, HOLD * 1000)
}
