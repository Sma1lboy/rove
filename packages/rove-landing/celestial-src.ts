/**
 * The hero's backdrop: a picture of rovers crossing dunes, rebuilt from square cells, each
 * printed with its own brightness (00–99). The picture is larger than the page, so the hero
 * only ever shows part of it; the pale sky is left out, which gives the cells a ragged edge.
 * It opens outward from the sun, then drifts slowly sideways so the numbers keep changing, and
 * it clears behind the headline so the text reads over it. Built to celestial.js by
 * `bun run build:celestial`; edit here, not there.
 */

const SRC = "/assets/hero-rovers.jpg"
/** A cell's pitch and its filled side, in px. */
const PITCH = 22
const TILE = 20
const FPS = 12
/** How much wider than the canvas the picture is drawn, and where its top edge sits (in canvas heights). */
const ZOOM = 1.22
const TOP = -0.2
/** Cells brighter than this are sky and are left out. */
const SKY = 0.84
/** px the picture drifts each way, and seconds for one swing. */
const DRIFT = 46
const SWING = 80
/** Seconds the picture takes to open from the sun. */
const OPEN = 2.4

const canvas = document.getElementById("sky") as HTMLCanvasElement | null
const ctx = canvas?.getContext("2d")

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

if (canvas && ctx) {
  const motion = matchMedia("(prefers-reduced-motion: reduce)")
  const picture = new Image()
  let pixels: ImageData | null = null
  let elapsed = 0
  let last = 0
  let timer = 0
  let visible = false

  const draw = () => {
    const rect = canvas.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    if (!w || !h || !pixels) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const style = getComputedStyle(canvas)
    ctx.font = `500 9px ${style.fontFamily}`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    const still = motion.matches
    const t = still ? OPEN : elapsed
    // The picture in canvas px: wider than the canvas, drifting sideways.
    const drawn = w * ZOOM
    const scale = pixels.width / drawn
    const left = (w - drawn) / 2 + (still ? 0 : DRIFT * Math.sin((t / SWING) * Math.PI * 2))
    const top = h * TOP
    // The sun, where the picture opens from: its place in the source, in canvas px.
    const sunX = left + drawn * 0.84
    const sunY = top + drawn * (pixels.height / pixels.width) * 0.21
    const reach = Math.hypot(w, h) * smooth(0, OPEN, t)

    for (let y = 0; y < h; y += PITCH) {
      for (let x = 0; x < w; x += PITCH) {
        const px = Math.floor((x + TILE / 2 - left) * scale)
        const py = Math.floor((y + TILE / 2 - top) * scale)
        if (px < 0 || py < 0 || px >= pixels.width || py >= pixels.height) continue
        const i = (py * pixels.width + px) * 4
        const r = pixels.data[i] ?? 0
        const g = pixels.data[i + 1] ?? 0
        const b = pixels.data[i + 2] ?? 0
        const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        if (light > SKY) continue
        // Clear behind the headline and the install box, and fade toward the top and bottom edges.
        const cx = (x - w * 0.5) / (w * 0.34)
        const cy = (y - h * 0.33) / (h * 0.31)
        const keep = (0.04 + 0.96 * smooth(0.78, 1.25, Math.hypot(cx, cy))) * smooth(0.03, 0.14, y / h) * (1 - smooth(0.74, 1, y / h))
        const open = smooth(reach, reach - 180, Math.hypot(x - sunX, y - sunY))
        const alpha = keep * open
        if (alpha < 0.03) continue
        ctx.globalAlpha = alpha * 0.82
        ctx.fillStyle = `rgb(${r} ${g} ${b})`
        ctx.fillRect(x, y, TILE, TILE)
        ctx.globalAlpha = alpha * (light > 0.5 ? 0.5 : 0.62)
        ctx.fillStyle = light > 0.5 ? "#000" : "#fff"
        ctx.fillText(String(Math.min(99, Math.floor(light * 100))).padStart(2, "0"), x + TILE / 2, y + TILE / 2 + 0.5)
      }
    }
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
  picture.onload = () => {
    // Read once at its own small size: a cell takes the pixel under its centre.
    const probe = document.createElement("canvas")
    probe.width = picture.naturalWidth
    probe.height = picture.naturalHeight
    const read = probe.getContext("2d", { willReadFrequently: true })
    if (!read) return
    read.drawImage(picture, 0, 0)
    pixels = read.getImageData(0, 0, probe.width, probe.height)
    sync()
  }
  picture.src = SRC
  new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting
    sync()
  }).observe(canvas)
  new ResizeObserver(() => {
    if (visible && !document.hidden) draw()
  }).observe(canvas)
  motion.addEventListener("change", sync)
  document.addEventListener("visibilitychange", sync)
}
