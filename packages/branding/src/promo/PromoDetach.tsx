import { AbsoluteFill } from "remotion"
import { Keycap, Marked, P, SANS, Wordmark, statement } from "./promo-theme"

// Persistent sessions over the film's deep-clay terminal cells.

const CLAY = ["#5c2a1b", "#6a311f", "#773823", "#54261a", "#7f3d27"]
const CELL = 50

// mulberry32, seeded: every render lays the same cells.
const CELLS = (() => {
  let s = 11
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const cells: { x: number; y: number; fill: string }[] = []
  for (let y = 0; y < 900; y += CELL)
    for (let x = 0; x < 1600; x += CELL) cells.push({ x, y, fill: CLAY[Math.floor(rnd() * CLAY.length)] })
  return cells
})()

const label: React.CSSProperties = {
  fontFamily: SANS,
  fontWeight: 600,
  fontSize: 32,
  color: "#FFFAF5",
  letterSpacing: "-0.02em",
  margin: "0 34px 0 8px",
}

export const PromoDetach: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: CLAY[0] }}>
    <svg width={1600} height={900} style={{ position: "absolute", inset: 0 }} shapeRendering="crispEdges">
      {CELLS.map((c) => (
        <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={CELL} height={CELL} fill={c.fill} />
      ))}
    </svg>
    <div style={{ ...statement(118), position: "absolute", left: 104, top: 132, color: "#FFFAF5" }}>
      Close the terminal.
      <br />
      They keep <Marked>working.</Marked>
    </div>
    <div
      style={{
        position: "absolute",
        left: 108,
        top: 420,
        width: 1000,
        fontFamily: SANS,
        fontSize: 34,
        lineHeight: 1.32,
        color: "#F1DDD0",
      }}
    >
      Sessions run on the host, not inside your terminal window. Quit the TUI or drop SSH, and the agents carry on.
    </div>
    <div style={{ position: "absolute", left: 108, top: 640, display: "flex", alignItems: "center", gap: 18 }}>
      <Keycap>ctrl</Keycap>
      <Keycap>q</Keycap>
      <span style={label}>twice to quit</span>
      <Keycap mono>rove</Keycap>
      <span style={label}>pick it all back up</span>
    </div>
    <Wordmark size={32} ink="#F1DDD0" bracket={P.accent} style={{ position: "absolute", right: 104, bottom: 76 }} />
  </AbsoluteFill>
)
