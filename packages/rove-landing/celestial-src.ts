/**
 * The hero's sky: a ringed planet far larger than the page, drawn in characters picked by
 * brightness. Only part of it is ever on screen: the limb arcs through the hero and the rings run
 * off both edges, and the picture thins out behind the headline so the text reads over it.
 * Painted on a canvas in the page's tokens. Built to celestial.js by `bun run build:celestial`;
 * edit here, not there.
 */

/** Darkest to brightest. */
const RAMP = " .·:-=+*#%@"
const FONT_PX = 14
const CELL_W = FONT_PX * 0.6
const CELL_H = FONT_PX * 1.25
const FPS = 12
/** The moment a still picture shows, for reduced motion. */
const STILL_T = 7
/** Ink per brightness band, quietest first; the last is the ring's crest. */
const TOKEN = ["--rule", "--ink-3", "--ink-2", "--accent"]
const ALPHA = [1, 0.5, 0.45, 0.7]

const canvas = document.getElementById("sky") as HTMLCanvasElement | null
const ctx = canvas?.getContext("2d")

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
/** A stable pseudo-random number in [0, 1) for a cell. */
const hash = (col: number, row: number) => {
  const n = Math.sin(col * 127.1 + row * 311.7) * 43758.5453
  return n - Math.floor(n)
}

if (canvas && ctx) {
  const motion = matchMedia("(prefers-reduced-motion: reduce)")
  let elapsed = STILL_T
  let last = 0
  let timer = 0
  let visible = false

  /** Brightness in [0, 1] of the scene at a point, in px from the canvas's top left. */
  const scene = (x: number, y: number, w: number, h: number, t: number): number => {
    // The planet is centred on the right edge, so half of it is off the page.
    const radius = h * 0.5
    const dx = (x - w) / radius
    const dy = (y - h * 0.5) / radius
    const d2 = dx * dx + dy * dy

    // The rings: a tilted, flattened disc around the planet, turning slowly.
    // Tilted so the near arm runs down and left, under the text and off the far edge.
    const tilt = 0.2
    const rx = dx * Math.cos(tilt) - dy * Math.sin(tilt)
    const ry = (dx * Math.sin(tilt) + dy * Math.cos(tilt)) / 0.3
    const r = Math.hypot(rx, ry)
    let ring = 0
    if (r > 1.3 && r < 2.75 && !(r > 1.92 && r < 2.02)) {
      const grain = 0.5 + 0.5 * Math.sin(r * 46 + Math.atan2(ry, rx) * 2 - t * 0.5)
      const edge = smooth(1.3, 1.4, r) * (1 - smooth(2.55, 2.75, r))
      ring = edge * (0.28 + 0.5 * grain)
    }

    let globe = 0
    if (d2 < 1) {
      const nz = Math.sqrt(1 - d2)
      // The light swings slowly from the upper left.
      const lx = -0.62 + 0.14 * Math.sin(t * 0.12)
      const lit = Math.max(0, dx * lx + dy * -0.52 + nz * 0.58)
      const bands = 0.07 * Math.sin(dy * 21 + 0.6 * Math.sin(dx * 3 + t * 0.07))
      globe = 0.08 + 0.8 * lit + bands
      // The far half of the rings is behind the globe.
      if (ry < 0) ring = 0
    }

    const star = hash(Math.round(x / CELL_W), Math.round(y / CELL_H))
    const twinkle = star > 0.992 ? 0.35 + 0.3 * Math.sin(t * 1.3 + star * 600) : 0
    return Math.max(globe, ring, d2 < 1 ? 0 : twinkle)
  }

  const draw = () => {
    const rect = canvas.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    if (!w || !h) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const style = getComputedStyle(canvas)
    ctx.font = `${FONT_PX}px ${style.fontFamily}`
    ctx.textBaseline = "top"
    const t = motion.matches ? STILL_T : elapsed
    const cols = Math.ceil(w / CELL_W)
    const rows = Math.ceil(h / CELL_H)
    // One string per row and ink: a monospace face keeps every character on its cell.
    const lines: string[][] = TOKEN.map(() => [])
    for (let row = 0; row < rows; row++) {
      const y = row * CELL_H
      const text = TOKEN.map(() => "")
      for (let col = 0; col < cols; col++) {
        const x = col * CELL_W
        // Thin behind the headline and the install box, and out toward the bottom edge.
        const cx = (x - w * 0.5) / (w * 0.36)
        const cy = (y - h * 0.38) / (h * 0.34)
        const quiet = 0.18 + 0.82 * smooth(0.7, 1.35, Math.hypot(cx, cy))
        const b = scene(x, y, w, h, t) * quiet * smooth(0, 0.12, y / h) * (1 - smooth(0.8, 1, y / h))
        const step = Math.min(RAMP.length - 1, Math.floor(b * RAMP.length))
        const ink = step === 0 ? -1 : b > 0.9 ? 3 : b > 0.62 ? 2 : b > 0.34 ? 1 : 0
        for (let i = 0; i < text.length; i++) text[i] += i === ink ? RAMP[step] : " "
      }
      for (let i = 0; i < text.length; i++) lines[i]?.push(text[i] ?? "")
    }
    lines.forEach((ink, i) => {
      ctx.fillStyle = style.getPropertyValue(TOKEN[i] ?? "") || style.color
      ctx.globalAlpha = ALPHA[i] ?? 1
      ink.forEach((text, row) => {
        if (text.trim()) ctx.fillText(text, 0, row * CELL_H)
      })
    })
  }

  const tick = (now: number) => {
    timer = requestAnimationFrame(tick)
    if (now - last < 1000 / FPS) return
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
  new ResizeObserver(() => {
    if (visible && !document.hidden) draw()
  }).observe(canvas)
  motion.addEventListener("change", sync)
  document.addEventListener("visibilitychange", sync)
  // The mono face may land after the first frame.
  void document.fonts?.ready.then(() => {
    if (visible) draw()
  })
}
