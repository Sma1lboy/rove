/**
 * The hero's backdrop: a coral peony, larger than the page, shown half as it is and half rebuilt
 * from square cells printed with their brightness (00–99). A line divides the two and sweeps
 * slowly by itself. The flower breathes (a slow swell and sway), and the cells are converted from
 * it on every frame, so their colours and numbers keep changing. The picture's plain background
 * is cut away, so the flower stands on the page's own paper and the cells end in a ragged edge
 * with a few loose ones. Both halves clear behind the headline so the text reads over them.
 *
 * Built to celestial.js by `bun run build:celestial`; edit here, not there.
 */

const SRC = "/assets/hero-peony.webp"
/** A cell's pitch and its filled side, in px. */
const PITCH = 16
const TILE = 15
/** The picture's height in canvas heights, and where its centre sits on the canvas (fractions of its width and height). */
const TALL = 1.12
const AT_X = 0.8
/** The flower's centre is never nearer the page's middle than this many px, so a narrow window pushes it off the edge, not over the text. */
const CLEAR = 600
const AT_Y = 0.5
/** How much the flower swells, how far it sways in px, and the speed of each in radians per second. */
const SWELL = 0.03
const SWAY = 10
const BREATH = 0.45
/** The size the picture is read at to colour the cells. */
const READ = 512
/** Where the line rests (a fraction of the width), how far it swings, and its speed in radians per second. */
const REST = 0.8
const SWING = 0.07
const PACE = 0.3

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
const board = (width: number, height: number, read = false) => {
  const el = document.createElement("canvas")
  el.width = Math.max(1, Math.round(width))
  el.height = Math.max(1, Math.round(height))
  return [el, el.getContext("2d", read ? { willReadFrequently: true } : undefined)] as const
}

if (canvas && ctx) {
  const motion = matchMedia("(prefers-reduced-motion: reduce)")
  const picture = new Image()
  /** The picture at its own size with its background cut away, and a small copy the cells read. */
  let cut: HTMLCanvasElement | null = null
  let pixels: ImageData | null = null
  let w = 0
  let h = 0
  let dpr = 1
  /** The two halves at the canvas's size, and what is erased from both (behind the text, toward the edges). */
  let [real, realPen] = board(1, 1)
  let [cells, cellPen] = board(1, 1)
  let [hole, holePen] = board(1, 1)
  let line = -1
  let last = 0
  let elapsed = 0
  let timer = 0
  let visible = false
  /** The flower's centre across the canvas, in px. */
  const centre = () => Math.max(w * AT_X, w / 2 + CLEAR)
  /** Where the line is `t` seconds in, in px. */
  const lineAt = (t: number) => w * (REST + SWING * Math.sin(t * PACE))

  /** Cut the pale, colourless background out of the picture. */
  const prepare = () => {
    const [full, pen] = board(picture.naturalWidth, picture.naturalHeight, true)
    if (!pen) return
    pen.drawImage(picture, 0, 0)
    const data = pen.getImageData(0, 0, full.width, full.height)
    const d = data.data
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] ?? 0
      const g = d[i + 1] ?? 0
      const b = d[i + 2] ?? 0
      const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      const colour = (Math.max(r, g, b) - Math.min(r, g, b)) / 255
      // Background is both bright and nearly grey; a pale petal still keeps some colour.
      d[i + 3] = Math.round(255 * (1 - smooth(0.82, 0.93, light) * (1 - smooth(0.05, 0.14, colour))))
    }
    pen.putImageData(data, 0, 0)
    cut = full
    const [small, smallPen] = board(READ, (READ * full.height) / full.width, true)
    if (!smallPen) return
    smallPen.drawImage(full, 0, 0, small.width, small.height)
    pixels = smallPen.getImageData(0, 0, small.width, small.height)
  }

  /** What is erased from both halves: behind the headline and the install box, and toward the top and bottom edges. */
  const punch = () => {
    ;[hole, holePen] = board(w * dpr, h * dpr)
    if (!holePen) return
    holePen.setTransform(dpr, 0, 0, dpr, 0, 0)
    holePen.save()
    holePen.translate(w * 0.5, h * 0.3)
    holePen.scale(w * 0.3, h * 0.3)
    const middle = holePen.createRadialGradient(0, 0, 0.55, 0, 0, 1.1)
    // The glass over the middle (.sky-glass) blurs what is left here.
    middle.addColorStop(0, "rgb(0 0 0 / 0.45)")
    middle.addColorStop(1, "rgb(0 0 0 / 0)")
    holePen.fillStyle = middle
    holePen.fillRect(-2, -2, 4, 4)
    holePen.restore()
    const edges = holePen.createLinearGradient(0, 0, 0, h)
    edges.addColorStop(0, "#000")
    edges.addColorStop(0.07, "#000")
    edges.addColorStop(0.2, "rgb(0 0 0 / 0)")
    edges.addColorStop(0.82, "rgb(0 0 0 / 0)")
    edges.addColorStop(1, "#000")
    holePen.fillStyle = edges
    holePen.fillRect(0, 0, w, h)
  }

  const measure = () => {
    const rect = canvas.getBoundingClientRect()
    const nextDpr = window.devicePixelRatio || 1
    if (rect.width === w && rect.height === h && nextDpr === dpr) return
    w = rect.width
    h = rect.height
    dpr = nextDpr
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ;[real, realPen] = board(w * dpr, h * dpr)
    ;[cells, cellPen] = board(w * dpr, h * dpr)
    punch()
  }

  /** Paint both halves with the flower as it is `t` seconds in. */
  const paint = (t: number) => {
    if (!cut || !pixels || !realPen || !cellPen || !w) return
    const tall = h * TALL * (1 + SWELL * Math.sin(t * BREATH))
    const wide = tall * (cut.width / cut.height)
    const left = centre() - wide / 2 + SWAY * Math.sin(t * BREATH * 0.6 + 1)
    const top = h * AT_Y - tall / 2
    const scale = pixels.width / wide

    realPen.setTransform(dpr, 0, 0, dpr, 0, 0)
    realPen.globalCompositeOperation = "source-over"
    realPen.clearRect(0, 0, w, h)
    realPen.imageSmoothingQuality = "high"
    realPen.drawImage(cut, left, top, wide, tall)
    realPen.setTransform(1, 0, 0, 1, 0, 0)
    realPen.globalCompositeOperation = "destination-out"
    realPen.drawImage(hole, 0, 0)

    cellPen.setTransform(dpr, 0, 0, dpr, 0, 0)
    cellPen.globalCompositeOperation = "source-over"
    cellPen.clearRect(0, 0, w, h)
    cellPen.font = `700 7.5px ${getComputedStyle(canvas).fontFamily}`
    cellPen.textAlign = "center"
    cellPen.textBaseline = "middle"
    // Only the cells right of where the line can reach are ever shown.
    const from = Math.max(0, Math.floor((w * (REST - SWING) - PITCH) / PITCH) * PITCH)
    for (let y = 0, row = 0; y < h; y += PITCH, row++) {
      for (let x = from, col = Math.round(from / PITCH); x < w; x += PITCH, col++) {
        const px = Math.floor((x + TILE / 2 - left) * scale)
        const py = Math.floor((y + TILE / 2 - top) * scale)
        if (px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) continue
        const i = (py * pixels.width + px) * 4
        const solid = (pixels.data[i + 3] ?? 0) / 255
        if (solid < 0.15) continue
        const r = pixels.data[i] ?? 0
        const g = pixels.data[i + 1] ?? 0
        const b = pixels.data[i + 2] ?? 0
        cellPen.fillStyle = `rgb(${r} ${g} ${b})`
        if (solid < 0.8) {
          // The edge: some cells are missing, the rest are small, pale and blank.
          if (hash(col, row) > 0.5) continue
          const side = TILE * (0.4 + 0.45 * hash(row, col))
          cellPen.globalAlpha = 0.3 + solid * 0.5
          cellPen.fillRect(x + (TILE - side) / 2, y + (TILE - side) / 2, side, side)
          continue
        }
        const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        cellPen.globalAlpha = 1
        cellPen.fillRect(x, y, TILE, TILE)
        cellPen.globalAlpha = 0.8
        cellPen.fillStyle = light > 0.55 ? "#3a1c12" : "#fff"
        cellPen.fillText(String(Math.min(99, Math.floor(light * 100))).padStart(2, "0"), x + TILE / 2, y + TILE / 2 + 0.5)
      }
    }
    cellPen.globalAlpha = 1
    cellPen.setTransform(1, 0, 0, 1, 0, 0)
    cellPen.globalCompositeOperation = "destination-out"
    cellPen.drawImage(hole, 0, 0)
  }

  const draw = () => {
    if (!w) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const at = Math.max(0, Math.min(canvas.width, Math.round(line * dpr)))
    if (at > 0) ctx.drawImage(real, 0, 0, at, canvas.height, 0, 0, at, canvas.height)
    if (at < canvas.width) ctx.drawImage(cells, at, 0, canvas.width - at, canvas.height, at, 0, canvas.width - at, canvas.height)
    // The line itself, fading out toward both ends.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const style = getComputedStyle(canvas)
    const ink = style.getPropertyValue("--ink-3") || style.color
    const stroke = ctx.createLinearGradient(0, 0, 0, h)
    stroke.addColorStop(0.08, "transparent")
    stroke.addColorStop(0.3, ink)
    stroke.addColorStop(0.7, ink)
    stroke.addColorStop(0.95, "transparent")
    ctx.fillStyle = stroke
    ctx.globalAlpha = 0.6
    ctx.fillRect(line - 0.5, 0, 1, h)
    ctx.globalAlpha = 1
  }

  const tick = (now: number) => {
    timer = requestAnimationFrame(tick)
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    elapsed += dt
    line += (lineAt(elapsed) - line) * Math.min(1, dt * 2.2)
    paint(elapsed)
    draw()
  }
  const sync = () => {
    cancelAnimationFrame(timer)
    if (!visible || document.hidden || !cut) return
    measure()
    if (line < 0) line = w
    if (motion.matches) {
      line = w * REST
      paint(0)
      draw()
      return
    }
    last = performance.now()
    timer = requestAnimationFrame(tick)
  }

  picture.onload = () => {
    prepare()
    sync()
  }
  picture.src = SRC
  new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting
    sync()
  }).observe(canvas)
  new ResizeObserver(() => {
    if (!visible || document.hidden || !cut) return
    measure()
    paint(elapsed)
    draw()
  }).observe(canvas)
  motion.addEventListener("change", sync)
  document.addEventListener("visibilitychange", sync)
}
