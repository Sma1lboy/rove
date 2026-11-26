/**
 * The hero's backdrop: a contour map in characters, far larger than the page, that a few rovers
 * cross. The land is a slow sum of waves, so its contour lines drift and reshape; each line is
 * drawn with the stroke that follows its direction (- / | \), every fourth one heavier. Rovers
 * travel along the contours in the accent and leave a fading trail. The map thins out behind the
 * headline so the text reads over it. Painted on a canvas in the page's tokens. Built to
 * celestial.js by `bun run build:celestial`; edit here, not there.
 */

const FONT_PX = 14
const CELL_W = FONT_PX * 0.6
const CELL_H = FONT_PX * 1.25
const FPS = 12
/** The moment a still picture shows, for reduced motion. */
const STILL_T = 7
/** Contour lines per unit of height; every INDEX-th is drawn heavier. */
const LEVELS = 15
const INDEX = 4
/** Ink per layer: contour, index contour, a rover's trail, a rover. */
const TOKEN = ["--rule", "--ink-3", "--accent", "--accent"]
const ALPHA = [1, 0.5, 0.45, 0.95]
const ROVERS = 6
/** Cells a trail keeps, and px a rover covers per second. */
const TRAIL = 46
const SPEED = 34

/** The land: [x frequency, y frequency, phase, drift per second, weight], in radians per px. */
const WAVES = [
  [0.0031, 0.0017, 0.4, 0.021, 1],
  [-0.0019, 0.0041, 2.1, -0.017, 0.8],
  [0.0058, -0.0036, 4.4, 0.03, 0.45],
  [0.0044, 0.0079, 1.3, -0.026, 0.3],
  [-0.0107, 0.0052, 5.2, 0.04, 0.16],
] as const
const WEIGHT = WAVES.reduce((sum, wave) => sum + wave[4], 0)

/** Height in [-1, 1] and its slope per px at a point. */
function land(x: number, y: number, t: number): [number, number, number] {
  let h = 0
  let gx = 0
  let gy = 0
  for (const [fx, fy, phase, drift, weight] of WAVES) {
    const a = x * fx + y * fy + phase + t * drift
    h += weight * Math.sin(a)
    const c = weight * Math.cos(a)
    gx += c * fx
    gy += c * fy
  }
  return [h / WEIGHT, gx / WEIGHT, gy / WEIGHT]
}

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

  /** Each rover: where it is, which way round the contour it goes, and the cells it has left. */
  const rovers = Array.from({ length: ROVERS }, (_, i) => ({
    x: hash(i, 7) * 1600,
    y: 80 + hash(i, 13) * 640,
    turn: i % 2 ? 1 : -1,
    trail: [] as number[],
  }))

  const size = () => {
    const rect = canvas.getBoundingClientRect()
    return [rect.width, rect.height] as const
  }

  /** Move every rover along its contour for `dt` seconds; one that leaves the map comes back on the far side. */
  const advance = (dt: number) => {
    const [w, h] = size()
    if (!w || !h) return
    const cols = Math.ceil(w / CELL_W)
    for (const rover of rovers) {
      const [, gx, gy] = land(rover.x, rover.y, elapsed)
      const slope = Math.hypot(gx, gy) || 1
      rover.x += ((-gy / slope) * rover.turn * SPEED + 6) * dt
      rover.y += (gx / slope) * rover.turn * SPEED * dt
      if (rover.x > w + 20) rover.x = -20
      if (rover.x < -20) rover.x = w + 20
      if (rover.y > h + 20) rover.y = -20
      if (rover.y < -20) rover.y = h + 20
      const cell = Math.round(rover.y / CELL_H) * cols + Math.round(rover.x / CELL_W)
      if (rover.trail[0] !== cell) rover.trail.unshift(cell)
      if (rover.trail.length > TRAIL) rover.trail.length = TRAIL
    }
  }

  const draw = () => {
    const [w, h] = size()
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

    const marks = new Map<number, [number, string]>()
    for (const rover of rovers)
      rover.trail.forEach((cell, age) => {
        if (!marks.has(cell)) marks.set(cell, age === 0 ? [3, "@"] : [2, age < TRAIL / 3 ? "+" : age < (TRAIL * 2) / 3 ? "·" : "."])
      })

    // One string per row and ink: a monospace face keeps every character on its cell.
    const lines: string[][] = TOKEN.map(() => [])
    for (let row = 0; row < rows; row++) {
      const y = row * CELL_H
      const text = TOKEN.map(() => "")
      for (let col = 0; col < cols; col++) {
        const x = col * CELL_W
        // Thin behind the headline and the install box, and out toward the top and bottom edges.
        const cx = (x - w * 0.5) / (w * 0.31)
        const cy = (y - h * 0.38) / (h * 0.33)
        const keep =
          (0.06 + 0.94 * smooth(0.8, 1.2, Math.hypot(cx, cy))) * smooth(0, 0.06, y / h) * (1 - smooth(0.84, 1, y / h))
        let ink = -1
        let char = " "
        const mark = marks.get(row * cols + col)
        if (mark && keep > 0.1) [ink, char] = mark
        else if (hash(col, row) < keep) {
          const [height, gx, gy] = land(x, y, t)
          const level = height * LEVELS
          const nearest = Math.round(level)
          // How far the nearest contour is, in cells: the height gap over the slope across one cell.
          const away = Math.abs(level - nearest) / (Math.hypot(gx * CELL_W, gy * CELL_H) * LEVELS + 1e-9)
          if (away < 0.5) {
            ink = ((nearest % INDEX) + INDEX) % INDEX === 0 ? 1 : 0
            // The line runs across the slope; pick the stroke nearest its direction on screen.
            const angle = (Math.atan2(gx * CELL_H, -gy * CELL_W) + Math.PI) % Math.PI
            char = angle < Math.PI / 8 || angle > (Math.PI * 7) / 8 ? "-" : angle < (Math.PI * 3) / 8 ? "\\" : angle < (Math.PI * 5) / 8 ? "|" : "/"
          }
        }
        for (let i = 0; i < text.length; i++) text[i] += i === ink ? char : " "
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
    const dt = (now - last) / 1000
    elapsed += dt
    last = now
    advance(dt)
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
  // A still picture still shows where the rovers have been.
  for (let i = 0; i < TRAIL; i++) advance(1 / FPS)
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
