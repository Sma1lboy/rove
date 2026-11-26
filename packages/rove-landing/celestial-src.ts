/**
 * The hero's backdrop: one picture of a rover, larger than the page, shown half as it is and half
 * rebuilt from square cells printed with their brightness (00–99). A line divides the two; it
 * sweeps slowly by itself and follows the pointer over the hero. The pale studio background is
 * cut away, so the rover stands on the page's own paper and the cells end in a ragged edge with
 * a few loose ones. Both halves clear behind the headline so the text reads over them.
 *
 * Both halves are painted once per size into layers; a frame only copies each layer up to the
 * line, so it runs at the display's own rate. Built to celestial.js by `bun run build:celestial`;
 * edit here, not there.
 */

const SRC = "/assets/hero-rover.webp"
/** A cell's pitch and its filled side, in px. */
const PITCH = 22
const TILE = 20
/** How much wider than the canvas the picture is drawn, and where its top edge sits (in canvas heights). */
const ZOOM = 1.18
const TOP = 0.02
/** Where the line rests (a fraction of the width), how far it swings, and its speed in radians per second. */
const REST = 0.5
const SWING = 0.2
const PACE = 0.32

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
  const picture = new Image()
  /** The picture with its background cut away, at its own size. */
  let cut: HTMLCanvasElement | null = null
  let pixels: ImageData | null = null
  /** The two halves at the canvas's size, already cleared behind the text. */
  let real: HTMLCanvasElement | null = null
  let cells: HTMLCanvasElement | null = null
  let w = 0
  let h = 0
  let dpr = 1
  let line = -1
  let pointer: number | null = null
  let last = 0
  let elapsed = 0
  let timer = 0
  let visible = false

  /** Cut the pale, colourless background out of the picture. */
  const prepare = () => {
    const board = document.createElement("canvas")
    board.width = picture.naturalWidth
    board.height = picture.naturalHeight
    const pen = board.getContext("2d", { willReadFrequently: true })
    if (!pen) return
    pen.drawImage(picture, 0, 0)
    const data = pen.getImageData(0, 0, board.width, board.height)
    for (let i = 0; i < data.data.length; i += 4) {
      const r = data.data[i] ?? 0
      const g = data.data[i + 1] ?? 0
      const b = data.data[i + 2] ?? 0
      const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      const colour = (Math.max(r, g, b) - Math.min(r, g, b)) / 255
      // Background is both bright and nearly grey; dust and highlights keep some colour.
      data.data[i + 3] = Math.round(255 * (1 - smooth(0.8, 0.9, light) * (1 - smooth(0.1, 0.22, colour))))
    }
    pen.putImageData(data, 0, 0)
    cut = board
    pixels = data
  }

  /** Erase a layer behind the headline and the install box, and toward its top and bottom edges. */
  const clear = (pen: CanvasRenderingContext2D) => {
    pen.globalCompositeOperation = "destination-out"
    pen.save()
    pen.translate(w * 0.5, h * 0.3)
    pen.scale(w * 0.36, h * 0.3)
    const hole = pen.createRadialGradient(0, 0, 0.55, 0, 0, 1.1)
    hole.addColorStop(0, "rgb(0 0 0 / 0.96)")
    hole.addColorStop(1, "rgb(0 0 0 / 0)")
    pen.fillStyle = hole
    pen.fillRect(-2, -2, 4, 4)
    pen.restore()
    const edges = pen.createLinearGradient(0, 0, 0, h)
    edges.addColorStop(0, "#000")
    edges.addColorStop(0.1, "rgb(0 0 0 / 0)")
    edges.addColorStop(0.8, "rgb(0 0 0 / 0)")
    edges.addColorStop(1, "#000")
    pen.fillStyle = edges
    pen.fillRect(0, 0, w, h)
    pen.globalCompositeOperation = "source-over"
  }

  const layer = () => {
    const board = document.createElement("canvas")
    board.width = Math.round(w * dpr)
    board.height = Math.round(h * dpr)
    const pen = board.getContext("2d")
    pen?.setTransform(dpr, 0, 0, dpr, 0, 0)
    return [board, pen] as const
  }

  /** Paint both halves for the canvas's current size. */
  const build = () => {
    if (!cut || !pixels || !w || !h) return
    const drawn = w * ZOOM
    const tall = drawn * (cut.height / cut.width)
    const left = (w - drawn) / 2
    const top = h * TOP
    const scale = cut.width / drawn

    const [realBoard, realPen] = layer()
    if (realPen) {
      realPen.drawImage(cut, left, top, drawn, tall)
      clear(realPen)
    }
    real = realBoard

    const [cellBoard, cellPen] = layer()
    if (cellPen) {
      cellPen.font = `700 9px ${getComputedStyle(canvas).fontFamily}`
      cellPen.textAlign = "center"
      cellPen.textBaseline = "middle"
      for (let y = 0, row = 0; y < h; y += PITCH, row++) {
        for (let x = 0, col = 0; x < w; x += PITCH, col++) {
          const px = Math.floor((x + TILE / 2 - left) * scale)
          const py = Math.floor((y + TILE / 2 - top) * scale)
          if (px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) continue
          const i = (py * pixels.width + px) * 4
          const solid = (pixels.data[i + 3] ?? 0) / 255
          if (solid < 0.12) continue
          const r = pixels.data[i] ?? 0
          const g = pixels.data[i + 1] ?? 0
          const b = pixels.data[i + 2] ?? 0
          const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
          cellPen.fillStyle = `rgb(${r} ${g} ${b})`
          if (solid < 0.6) {
            // The edge: some cells are missing, the rest are small, pale and blank.
            if (hash(col, row) > 0.55) continue
            const side = TILE * (0.45 + 0.4 * hash(row, col))
            cellPen.globalAlpha = 0.35 + solid * 0.5
            cellPen.fillRect(x + (TILE - side) / 2, y + (TILE - side) / 2, side, side)
            continue
          }
          cellPen.globalAlpha = 1
          cellPen.fillRect(x, y, TILE, TILE)
          cellPen.globalAlpha = 0.78
          cellPen.fillStyle = light > 0.52 ? "#2a1a12" : "#fff"
          cellPen.fillText(String(Math.min(99, Math.floor(light * 100))).padStart(2, "0"), x + TILE / 2, y + TILE / 2 + 0.5)
        }
      }
      cellPen.globalAlpha = 1
      clear(cellPen)
    }
    cells = cellBoard
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
    build()
  }

  const draw = () => {
    if (!real || !cells || !w) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const at = Math.max(0, Math.min(canvas.width, Math.round(line * dpr)))
    if (at > 0) ctx.drawImage(real, 0, 0, at, canvas.height, 0, 0, at, canvas.height)
    if (at < canvas.width) ctx.drawImage(cells, at, 0, canvas.width - at, canvas.height, at, 0, canvas.width - at, canvas.height)
    // The line, fading out toward the text above it, and its handle under the install box.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const style = getComputedStyle(canvas)
    const ink = style.getPropertyValue("--ink-3") || style.color
    const stroke = ctx.createLinearGradient(0, h * 0.5, 0, h)
    stroke.addColorStop(0, "transparent")
    stroke.addColorStop(0.25, ink)
    stroke.addColorStop(0.75, ink)
    stroke.addColorStop(1, "transparent")
    ctx.fillStyle = stroke
    ctx.globalAlpha = 0.7
    ctx.fillRect(line - 0.5, h * 0.5, 1, h * 0.5)
    ctx.globalAlpha = 1
    const knobY = h * 0.69
    ctx.beginPath()
    ctx.arc(line, knobY, 13, 0, Math.PI * 2)
    ctx.fillStyle = style.getPropertyValue("--paper") || "#fff"
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = style.getPropertyValue("--rule") || ink
    ctx.stroke()
    ctx.fillStyle = style.getPropertyValue("--ink-2") || ink
    ctx.font = `600 11px ${style.fontFamily}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("‹ ›", line, knobY)
  }

  const tick = (now: number) => {
    timer = requestAnimationFrame(tick)
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    elapsed += dt
    const target = pointer ?? w * (REST + SWING * Math.sin(elapsed * PACE))
    line += (target - line) * Math.min(1, dt * (pointer === null ? 2.2 : 9))
    draw()
  }
  const sync = () => {
    cancelAnimationFrame(timer)
    if (!visible || document.hidden || !cut) return
    measure()
    if (line < 0) line = w
    if (motion.matches) {
      line = w * REST
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
    draw()
  }).observe(canvas)
  motion.addEventListener("change", sync)
  document.addEventListener("visibilitychange", sync)
  // The canvas takes no pointer events (it sits under the page), so the hero reports the pointer.
  const hero = canvas.closest("section")
  if (hero && matchMedia("(hover: hover)").matches) {
    hero.addEventListener("pointermove", (e) => {
      pointer = e.clientX - canvas.getBoundingClientRect().left
    })
    hero.addEventListener("pointerleave", () => {
      pointer = null
    })
  }
}
