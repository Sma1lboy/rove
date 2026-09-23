import { Easing, interpolate, random, useCurrentFrame } from "remotion"

// A plotter pen. Every mark in the life sheet is a polyline this file builds
// and then draws by arc length, so the pen tip is always a known point.

export type Pt = readonly [number, number]
export type Stroke = Pt[]

let seedCounter = 0

/** Resample a polyline into short steps and push each point off the line a little: ink, not vector. */
function wobble(pts: Pt[], amp = 0.3, step = 9): Stroke {
  const seed = seedCounter++
  const out: Pt[] = []
  for (let s = 0; s < pts.length - 1; s++) {
    const [ax, ay] = pts[s]
    const [bx, by] = pts[s + 1]
    const dist = Math.hypot(bx - ax, by - ay)
    const n = Math.max(1, Math.ceil(dist / step))
    const nx = -(by - ay) / (dist || 1)
    const ny = (bx - ax) / (dist || 1)
    for (let i = 0; i < n; i++) {
      const t = i / n
      const o = (random(`${seed}-${s}-${i}`) - 0.5) * 2 * amp
      out.push([ax + (bx - ax) * t + nx * o, ay + (by - ay) * t + ny * o])
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

export const line = (a: Pt, b: Pt): Stroke[] => [wobble([a, b])]

export const polyline = (pts: Pt[]): Stroke[] => [wobble(pts)]

export const rect = (x: number, y: number, w: number, h: number): Stroke[] => [
  wobble([
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y - 1.5],
  ]),
]

/** Closes with a small overshoot, the way a hand-inked circle does. */
export const circle = (cx: number, cy: number, r: number): Stroke[] => {
  const pts: Pt[] = []
  const n = Math.max(24, Math.round(r * 1.2))
  const start = random(`c${seedCounter}`) * Math.PI * 2
  for (let i = 0; i <= n + 2; i++) {
    const a = start + (i / n) * Math.PI * 2
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return [wobble(pts, 0.25, 6)]
}

export const dashed = (a: Pt, b: Pt, dash = 14, gap = 9): Stroke[] => {
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1])
  const out: Stroke[] = []
  for (let d = 0; d < dist; d += dash + gap) {
    const t0 = d / dist
    const t1 = Math.min(1, (d + dash) / dist)
    out.push(
      wobble([
        [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0],
        [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1],
      ]),
    )
  }
  return out
}

/** Vertical hatching inside a rect — the section fill of a drafted part. */
export const hatch = (x: number, y: number, w: number, h: number, pitch = 7): Stroke[] => {
  const out: Stroke[] = []
  for (let hx = x + pitch / 2; hx < x + w; hx += pitch) out.push(...line([hx, y + h], [hx, y]))
  return out
}

/** Revision triangle, apex up. */
export const triangle = (cx: number, cy: number, s: number): Stroke[] => [
  wobble(
    [
      [cx, cy - s],
      [cx + s * 0.9, cy + s * 0.6],
      [cx - s * 0.9, cy + s * 0.6],
      [cx, cy - s - 1],
    ],
    0.4,
    4,
  ),
]

const segLen = (s: Stroke) => {
  let l = 0
  for (let i = 1; i < s.length; i++) l += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1])
  return l
}

/**
 * Draw `strokes` in order over [from, from + dur], pen tip visible while it moves.
 * Inside a zoomed viewport pass its `zoom`: lineweights stay plotted, as in CAD.
 */
export const Ink: React.FC<{
  strokes: Stroke[]
  from: number
  dur: number
  color: string
  width?: number
  opacity?: number
  showPen?: boolean
  zoom?: number
}> = ({ strokes, from, dur, color, width = 1.6, opacity = 1, showPen = true, zoom }) => {
  const frame = useCurrentFrame()
  const p = interpolate(frame, [from, from + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  })
  if (p <= 0) return null
  const lens = strokes.map(segLen)
  let budget = p * lens.reduce((a, b) => a + b, 0)
  let tip: Pt | null = null
  const drawn: string[] = []
  for (let k = 0; k < strokes.length && budget > 0; k++) {
    const s = strokes[k]
    const pts: Pt[] = [s[0]]
    for (let i = 1; i < s.length; i++) {
      const d = Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1])
      if (budget >= d) {
        budget -= d
        pts.push(s[i])
        continue
      }
      const t = budget / d
      pts.push([s[i - 1][0] + (s[i][0] - s[i - 1][0]) * t, s[i - 1][1] + (s[i][1] - s[i - 1][1]) * t])
      budget = 0
      break
    }
    tip = pts[pts.length - 1]
    drawn.push(pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "))
  }
  return (
    <g opacity={opacity}>
      {drawn.map((d, i) => (
        <polyline
          key={i}
          points={d}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect={zoom ? "non-scaling-stroke" : undefined}
        />
      ))}
      {showPen && tip && p < 1 ? <PenTip at={tip} color={color} zoom={zoom ?? 1} /> : null}
    </g>
  )
}

const PenTip: React.FC<{ at: Pt; color: string; zoom: number }> = ({ at: [x, y], color, zoom }) => {
  const u = 1 / zoom
  const fixed = zoom === 1 ? undefined : "non-scaling-stroke"
  return (
    <g stroke={color} strokeWidth={1} fill="none">
      <circle cx={x} cy={y} r={6 * u} vectorEffect={fixed} />
      <line x1={x - 12 * u} y1={y} x2={x - 8 * u} y2={y} vectorEffect={fixed} />
      <line x1={x + 8 * u} y1={y} x2={x + 12 * u} y2={y} vectorEffect={fixed} />
      <line x1={x} y1={y - 12 * u} x2={x} y2={y - 8 * u} vectorEffect={fixed} />
      <line x1={x} y1={y + 8 * u} x2={x} y2={y + 12 * u} vectorEffect={fixed} />
    </g>
  )
}

/** Lettering, set one character at a time like a lettering guide. */
export const Letter: React.FC<{
  x: number
  y: number
  text: string
  from: number
  cps?: number
  size?: number
  family: string
  color: string
  anchor?: "start" | "middle" | "end"
  weight?: number
  spacing?: number
}> = ({ x, y, text, from, cps = 45, size = 16, family, color, anchor = "start", weight = 500, spacing = 1 }) => {
  const frame = useCurrentFrame()
  const n = Math.floor(Math.max(0, frame - from) * (cps / 30))
  if (n <= 0) return null
  return (
    <text
      x={x}
      y={y}
      fill={color}
      fontFamily={family}
      fontSize={size}
      fontWeight={weight}
      letterSpacing={spacing}
      textAnchor={anchor}
    >
      {text.slice(0, n)}
    </text>
  )
}
