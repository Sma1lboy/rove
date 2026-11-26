/**
 * The hero's backdrop: a time-lapse of a flower opening, larger than the page, converted as it
 * plays. Left of a slowly sweeping line it is the film itself; right of the line, every frame is
 * rebuilt from square cells printed with their brightness (00–99). The green behind the flower is
 * cut away frame by frame, so the flower stands on the page's own paper and the cells end in a
 * ragged edge with a few loose ones. Both halves clear behind the headline so the text reads
 * over them.
 *
 * The film is "Time-lapse of a flower blooming" by Ajith Samuel, CC BY 3.0 (credited in the page
 * footer), played forward then backward so the loop has no jump. Built to celestial.js by
 * `bun run build:celestial`; edit here, not there.
 */

const SRC = "/assets/hero-bloom.mp4"
/** A cell's pitch and its filled side, in px. */
const PITCH = 16
const TILE = 15
/** The film's height in canvas heights, and where the open flower's centre sits on the canvas (fractions of its width and height). */
const TALL = 1.12
const AT_X = 0.78
const AT_Y = 0.5
/** Where the open flower's centre is in the film's own frame. */
const FLOWER_X = 0.6
const FLOWER_Y = 0.55
/** The size the film is read at to find the flower and colour the cells. */
const READ_W = 420
/** Where the line rests (a fraction of the width), how far it swings, and its speed in radians per second. */
const REST = 0.78
const SWING = 0.1
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
  const film = document.createElement("video")
  film.muted = true
  film.loop = true
  film.playsInline = true
  film.preload = "auto"
  film.src = SRC

  let w = 0
  let h = 0
  let dpr = 1
  /** The film at a small size, with everything but the flower made transparent. */
  let [cut, cutPen] = board(1, 1, true)
  let pixels: ImageData | null = null
  /** The two halves at the canvas's size, and what is erased from both (behind the text, toward the edges). */
  let [real, realPen] = board(1, 1)
  let [cells, cellPen] = board(1, 1)
  let [hole, holePen] = board(1, 1)
  /** Each cell's eased colour, by row * 512 + col, and whether it has one yet. */
  const held = new Float32Array(512 * 256 * 3)
  const seen = new Uint8Array(512 * 256)
  let line = -1
  let last = 0
  let elapsed = 0
  let timer = 0
  let visible = false
  let ready = false

  /** What is erased from both halves: behind the headline and the install box, and toward the top and bottom edges. */
  const punch = () => {
    ;[hole, holePen] = board(w * dpr, h * dpr)
    if (!holePen) return
    holePen.setTransform(dpr, 0, 0, dpr, 0, 0)
    holePen.save()
    holePen.translate(w * 0.5, h * 0.3)
    holePen.scale(w * 0.3, h * 0.3)
    const middle = holePen.createRadialGradient(0, 0, 0.55, 0, 0, 1.1)
    middle.addColorStop(0, "rgb(0 0 0 / 0.97)")
    middle.addColorStop(1, "rgb(0 0 0 / 0)")
    holePen.fillStyle = middle
    holePen.fillRect(-2, -2, 4, 4)
    holePen.restore()
    const edges = holePen.createLinearGradient(0, 0, 0, h)
    edges.addColorStop(0, "#000")
    edges.addColorStop(0.1, "rgb(0 0 0 / 0)")
    edges.addColorStop(0.8, "rgb(0 0 0 / 0)")
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

  /** Read the film's current frame and keep only the flower: warm pixels stay, the green behind them goes. */
  const read = () => {
    if (!film.videoWidth) return
    const readH = Math.round((READ_W * film.videoHeight) / film.videoWidth)
    if (cut.width !== READ_W || cut.height !== readH) [cut, cutPen] = board(READ_W, readH, true)
    if (!cutPen) return
    cutPen.globalCompositeOperation = "copy"
    cutPen.drawImage(film, 0, 0, READ_W, readH)
    const frame = cutPen.getImageData(0, 0, READ_W, readH)
    const d = frame.data
    for (let i = 0; i < d.length; i += 4) {
      const warm = ((d[i] ?? 0) - (d[i + 1] ?? 0)) / 255
      d[i + 3] = Math.round(255 * smooth(0.02, 0.14, warm))
    }
    cutPen.putImageData(frame, 0, 0)
    pixels = frame
  }

  /** Paint both halves from the frame just read. */
  const paint = () => {
    if (!pixels || !realPen || !cellPen || !w) return
    const tall = h * TALL
    const wide = tall * (pixels.width / pixels.height)
    const left = w * AT_X - wide * FLOWER_X
    const top = h * AT_Y - tall * FLOWER_Y
    const scale = pixels.width / wide

    realPen.setTransform(dpr, 0, 0, dpr, 0, 0)
    realPen.globalCompositeOperation = "copy"
    realPen.drawImage(film, left, top, wide, tall)
    // Keep the film only where the small cut-out says the flower is.
    realPen.globalCompositeOperation = "destination-in"
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
    const from = Math.floor((w * (REST - SWING) - PITCH) / PITCH) * PITCH
    for (let y = 0, row = 0; y < h; y += PITCH, row++) {
      for (let x = Math.max(0, from), col = Math.round(x / PITCH); x < w; x += PITCH, col++) {
        const px = Math.floor((x + TILE / 2 - left) * scale)
        const py = Math.floor((y + TILE / 2 - top) * scale)
        if (px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) continue
        const i = (py * pixels.width + px) * 4
        const solid = (pixels.data[i + 3] ?? 0) / 255
        if (solid < 0.15) {
          seen[row * 512 + col] = 0
          continue
        }
        // Each cell eases toward the film's colour, so compression noise does not make its number flicker.
        const k = (row * 512 + col) * 3
        const fresh = !seen[k / 3]
        seen[k / 3] = 1
        for (let c = 0; c < 3; c++) {
          const now = pixels.data[i + c] ?? 0
          held[k + c] = fresh ? now : (held[k + c] ?? now) + (now - (held[k + c] ?? now)) * 0.25
        }
        const r = Math.round(held[k] ?? 0)
        const g = Math.round(held[k + 1] ?? 0)
        const b = Math.round(held[k + 2] ?? 0)
        cellPen.fillStyle = `rgb(${r} ${g} ${b})`
        if (solid < 0.7) {
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
        cellPen.fillText(
          String(Math.min(99, Math.floor(light * 100))).padStart(2, "0"),
          x + TILE / 2,
          y + TILE / 2 + 0.5,
        )
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
    if (at < canvas.width)
      ctx.drawImage(cells, at, 0, canvas.width - at, canvas.height, at, 0, canvas.width - at, canvas.height)
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

  /** The film's frame, last read, so a frame the film has not advanced on only moves the line. */
  let shown = -1
  const tick = (now: number) => {
    timer = requestAnimationFrame(tick)
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    elapsed += dt
    line += (w * (REST + SWING * Math.sin(elapsed * PACE)) - line) * Math.min(1, dt * 2.2)
    if (film.currentTime !== shown) {
      shown = film.currentTime
      read()
      paint()
    }
    draw()
  }
  const sync = () => {
    cancelAnimationFrame(timer)
    if (!visible || document.hidden || !ready) {
      film.pause()
      return
    }
    measure()
    if (line < 0) line = w
    if (motion.matches) {
      // A still: the open flower, the line at rest.
      film.pause()
      line = w * REST
      read()
      paint()
      draw()
      return
    }
    void film.play().catch(() => {})
    last = performance.now()
    timer = requestAnimationFrame(tick)
  }

  film.addEventListener("loadeddata", () => {
    ready = true
    // Reduced motion shows the flower open: the film's midpoint, where forward meets backward.
    if (motion.matches) film.currentTime = film.duration / 2
    sync()
  })
  film.addEventListener("seeked", () => {
    if (motion.matches) sync()
  })
  new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting
    sync()
  }).observe(canvas)
  new ResizeObserver(() => {
    if (!visible || document.hidden || !ready) return
    measure()
    read()
    paint()
    draw()
  }).observe(canvas)
  motion.addEventListener("change", sync)
  document.addEventListener("visibilitychange", sync)
}
