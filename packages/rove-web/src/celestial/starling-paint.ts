import {
  FLIGHT_SECONDS,
  SKY_HEIGHT,
  SKY_WIDTH,
  type Starling,
  backgroundStars,
  flightPosition,
  flock,
  smooth,
} from "./starling-flight.ts"

type Point = readonly [number, number]

function silhouette(
  ink: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  size: number,
  flap: number,
  roll: number,
  shadow: string,
  light: string,
) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const project = (fore: number, side: number, up = 0): Point => [
    x + size * (fore * cos - side * sin + 0.22 * up),
    y + size * (fore * sin + side * cos * 0.67 - up * 0.7),
  ]
  function polygon(color: string, first: Point, ...points: Point[]) {
    ink.fillStyle = color
    ink.beginPath()
    ink.moveTo(...first)
    for (const point of points) ink.lineTo(...point)
    ink.closePath()
    ink.fill()
  }
  function wing(side: number, color: string) {
    const width = 1 + side * roll * 0.42
    const lift = flap * 0.85 + side * roll * 0.5
    const joint = (fore: number, spread: number, height: number) => project(fore, side * spread * width, height * lift)
    polygon(
      color,
      project(3, side * 0.4),
      joint(3, 3, 0.8),
      joint(1.4, 6.3, 3.8),
      joint(-4.9, 10.6, 6),
      joint(-3.7, 6.2, 3.9),
      joint(-4.3, 6.5, 3.5),
      joint(-2.3, 2.7, 0.5),
      project(-2, side * 0.45),
    )
  }
  wing(-1, shadow)
  wing(1, light)
  polygon(
    light,
    project(6, 0),
    project(3.1, -0.95),
    project(0.8, -1.05),
    project(-2.4, -0.75),
    project(-5.9, -1.35),
    project(-5.6, 0.85),
    project(-2.2, 0.55),
    project(0.8, 1.18),
    project(2.8, 0.72),
  )
}

function openingStar(
  ink: CanvasRenderingContext2D,
  bird: Starling,
  x: number,
  y: number,
  time: number,
  presence: number,
  small: boolean,
  core: string,
  rays: string,
) {
  const fade = 1 - presence
  const pulse = 0.5 + 0.5 * Math.sin(time * (1.6 + bird.pace) + bird.phase)
  // Snap the core to a whole cell: antialiasing alone can erase a star on a phone.
  ink.save()
  ink.setTransform(
    1,
    0,
    0,
    1,
    Math.round((x * ink.canvas.width) / SKY_WIDTH),
    Math.round((y * ink.canvas.height) / SKY_HEIGHT),
  )
  if (bird.lead || bird.glint || bird.depth > 0.945) {
    const reach = (bird.lead ? 6 : 3) + Math.round(pulse * 2)
    const arm = Math.max(2, Math.round(reach * fade * 0.82))
    ink.fillStyle = rays
    ink.globalAlpha = fade * (0.69 + 0.18 * pulse)
    ink.fillRect(-arm, 0, 2 * arm + 1, 1)
    ink.fillRect(0, -arm - 1, 1, 2 * arm + 3)
    ink.globalAlpha = fade * (0.38 + 0.14 * pulse)
    ink.fillRect(-2, -2, 1, 1)
    ink.fillRect(2, 2, 1, 1)
    ink.fillRect(-2, 2, 1, 1)
    ink.fillRect(2, -2, 1, 1)
    ink.fillStyle = core
    ink.globalAlpha = fade
    ink.fillRect(-1, -1, 3, 3)
  } else {
    const middle = bird.depth > 0.54 || bird.copper
    ink.fillStyle = middle ? core : rays
    ink.globalAlpha = fade * (middle ? 0.83 + 0.17 * pulse : 0.56 + 0.2 * pulse)
    const side = middle || small ? 2 : 1
    ink.fillRect(0, 0, side, side)
  }
  ink.restore()
}

function drawFlock(ink: CanvasRenderingContext2D, time: number, small: boolean, style: CSSStyleDeclaration) {
  const bright = style.getPropertyValue("--color-ink").trim()
  const muted = style.getPropertyValue("--color-muted").trim()
  const accent = style.getPropertyValue("--color-accent").trim()
  const subtle = style.getPropertyValue("--color-subtle").trim()
  const starCore = `color-mix(in srgb, ${bright} 60%, ${style.colorScheme === "light" ? "black" : "white"})`
  const rays = `color-mix(in srgb, ${muted} 60%, ${bright})`
  const warmCore = `color-mix(in srgb, ${bright} 55%, ${accent})`
  const copperShadow = `color-mix(in srgb, ${accent} 70%, ${style.getPropertyValue("--color-paper")})`
  ink.setTransform(ink.canvas.width / SKY_WIDTH, 0, 0, ink.canvas.height / SKY_HEIGHT, 0, 0)
  ink.clearRect(0, 0, SKY_WIDTH, SKY_HEIGHT)
  ink.fillStyle = subtle
  for (const star of backgroundStars) {
    ink.globalAlpha = 0.33 + 0.18 * Math.sin(time * 0.52 + star.phase)
    ink.fillRect(star.x, star.y, 1.9, 1.9)
  }
  for (const bird of flock) {
    const wake = smooth((time - 1.8 - bird.along * 0.59 - bird.depth * 0.56) / 2.25)
    const settle = smooth((time - 14.85 - bird.along * 0.36) / 1.87)
    const presence = wake * (1 - settle)
    const loc = presence > 0 ? flightPosition(bird, time) : { x: bird.starX, y: bird.starY, near: 0 }
    const x = bird.starX + (loc.x - bird.starX) * presence
    const y = bird.starY + (loc.y - bird.starY) * presence
    if (presence < 0.97)
      openingStar(
        ink,
        bird,
        x,
        y,
        time,
        presence,
        small,
        bird.copper ? warmCore : starCore,
        bird.copper ? accent : rays,
      )
    if (presence < 0.04) continue
    const ahead = flightPosition(bird, time + 0.05)
    const angle = Math.atan2(ahead.y - loc.y, ahead.x - loc.x)
    const flap = Math.sin(time * (3.9 + bird.pace * 2.4) + bird.phase)
    const roll = 0.74 * Math.sin(time * 1.18 + bird.along * 2.4 + 0.26 * bird.phase)
    const size =
      (0.31 + 0.51 * bird.depth ** 1.8 + loc.near * (bird.lead ? 2.7 : 1.55)) *
      (small ? 1.18 : 1) *
      (0.28 + 0.72 * presence)
    ink.globalAlpha = presence * (0.68 + 0.32 * bird.depth)
    silhouette(
      ink,
      x,
      y,
      angle,
      size,
      flap,
      roll,
      bird.copper ? copperShadow : subtle,
      bird.copper ? accent : bird.depth > 0.5 ? bright : muted,
    )
  }
  ink.globalAlpha = 1
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/** All reads and dithering stay on the small field, even on Retina displays. */
export function starlingPainter(canvas: HTMLCanvasElement) {
  const field = document.createElement("canvas")
  const ink = field.getContext("2d", { willReadFrequently: true })
  const output = canvas.getContext("2d")
  const style = getComputedStyle(canvas)
  return (seconds: number) => {
    if (!ink || !output || !canvas.clientWidth || !canvas.clientHeight) return
    const small = canvas.clientWidth < 550
    const columns = small ? 460 : 440
    if (field.width !== columns) {
      field.width = columns
      field.height = Math.round((columns * SKY_HEIGHT) / SKY_WIDTH)
    }
    drawFlock(ink, seconds % FLIGHT_SECONDS, small, style)
    const image = ink.getImageData(0, 0, field.width, field.height)
    let alpha = 3
    for (let row = 0; row < field.height; row++) {
      for (let col = 0; col < field.width; col++, alpha += 4) {
        const opacity = image.data[alpha]
        if (!opacity) continue
        const cell = BAYER[(col & 3) + 4 * (row & 3)]
        image.data[alpha] = opacity > 12 + 7 * cell ? Math.max(135, opacity) * (cell > 12 ? 0.45 : 1) : 0
      }
    }
    ink.putImageData(image, 0, 0)
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.round(canvas.clientWidth * ratio)
    const height = Math.round(canvas.clientHeight * ratio)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    output.clearRect(0, 0, width, height)
    output.imageSmoothingEnabled = false
    const scale = Math.min(width / SKY_WIDTH, height / SKY_HEIGHT) * (small ? 1.24 : 1)
    const w = SKY_WIDTH * scale
    const h = SKY_HEIGHT * scale
    output.drawImage(field, (width - w) / 2, (height - h) / 2, w, h)
  }
}
