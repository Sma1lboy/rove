import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono"
import { loadFont as loadTech } from "@remotion/google-fonts/SairaCondensed"
import { AbsoluteFill, Html5Audio, interpolate, staticFile, useCurrentFrame } from "remotion"
import { type Box, cameraAt, FIELD, framings, strokesBox, union, viewTransform } from "./camera"
import { Ink, Letter, type Pt, type Stroke, circle, dashed, hatch, line, polyline, rect, triangle } from "./pen"
import { DRAW, LIFE, partStart, RELETTER, RENAME_PART } from "./timeline"

// "Rove draws its own life": one drafting sheet, inked part by part from the
// first commit (2026-05-08) to today. No images — every mark is a polyline from
// ./pen. Palette and lettering follow the rove.run sheet (kobe-landing/blueprint.css):
// one ink on one ground, terracotta only on revision marks and the part being drawn.
// The drawing field is a viewport (./camera) that pulls back as the system grows;
// the revision table, timeline and title block are the sheet itself and never move.

const { fontFamily: TECH } = loadTech("normal", { weights: ["500", "700"] })
const { fontFamily: MONO } = loadMono("normal", { weights: ["400", "500"] })

const SHEETS = {
  plot: { paper: "#E6E8E9", ink: "#15181B", ink2: "#464C52", ink3: "#8A9198", rule: "#BCC1C4", accent: "#B85B3A" },
  cyanotype: { paper: "#0A2340", ink: "#E7EDF5", ink2: "#A9BDD4", ink3: "#6E8AAA", rule: "#274766", accent: "#E08B66" },
} as const
export type LifeTheme = keyof typeof SHEETS

const LAST_DAY = 137
const TOTAL_COMMITS = 3358

// Commits per month from `git log` on main; May counts from day 0.
const MONTHS = [
  { name: "MAY", day: 0, commits: 651 },
  { name: "JUN", day: 24, commits: 584 },
  { name: "JUL", day: 54, commits: 780 },
  { name: "AUG", day: 85, commits: 843 },
  { name: "SEP", day: 116, commits: 500 },
] as const

type Label = { x: number; y: number; text: string }
type Part = {
  day: number
  date: string
  rev: string
  note: string
  strokes: Stroke[]
  labels: Label[]
  /** Drawn on the sheet (the title block), not in the zooming field. */
  sheet?: boolean
}

const box = (x: number, y: number, w = 150, h = 150): Stroke[] => [
  ...rect(x, y, w, h),
  ...line([x, y + h / 3], [x + w, y + h / 3]),
  ...line([x, y + (2 * h) / 3], [x + w, y + (2 * h) / 3]),
]

const engine = (y: number): Stroke[] => [...line([1110, y], [1156, y]), ...circle(1190, y, 34)]

/** Revision cloud: scallops bulging outward (edges run clockwise) along a rectangle. */
const cloud = (x: number, y: number, w: number, h: number, r = 22): Stroke[] => {
  const corners: Pt[] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ]
  const pts: Pt[] = []
  for (let c = 0; c < 4; c++) {
    const [ax, ay] = corners[c]
    const [bx, by] = corners[c + 1]
    const len = Math.hypot(bx - ax, by - ay)
    const n = Math.round(len / (r * 2))
    const ux = (bx - ax) / len
    const uy = (by - ay) / len
    for (let i = 0; i < n; i++) {
      for (let k = 0; k <= 8; k++) {
        const t = (i + k / 8) / n
        const bulge = Math.sin((k / 8) * Math.PI) * r * 0.7
        pts.push([ax + (bx - ax) * t + uy * bulge, ay + (by - ay) * t - ux * bulge])
      }
    }
  }
  return polyline(pts)
}

const PARTS: Part[] = [
  {
    day: 0,
    date: "05-08",
    rev: "0.0.0",
    note: "DAY 0 · A TASK = WORKTREE + BRANCH + TTY",
    strokes: box(520, 260),
    labels: [
      { x: 530, y: 293, text: "WORKTREE" },
      { x: 530, y: 343, text: "BRANCH" },
      { x: 530, y: 393, text: "TERMINAL" },
      { x: 520, y: 246, text: "TASK" },
    ],
  },
  {
    day: 1,
    date: "05-09",
    rev: "0.1.1",
    note: "MANY TASKS, ONE SIDEBAR, CLAUDE CODE",
    strokes: [
      ...box(700, 260),
      ...box(880, 260),
      ...rect(380, 230, 60, 430),
      ...[0, 1, 2, 3, 4, 5, 6].flatMap((i) => line([388, 262 + i * 52], [432, 262 + i * 52])),
      ...line([1030, 335], [1110, 335]),
      ...line([1110, 220], [1110, 460]),
      ...engine(240),
    ],
    labels: [
      { x: 380, y: 684, text: "SIDEBAR" },
      { x: 1234, y: 246, text: "CLAUDE" },
    ],
  },
  {
    day: 2,
    date: "05-10",
    rev: "0.5.4",
    note: "A DAEMON — CLOSE THE TUI, WORK GOES ON",
    strokes: [
      ...circle(775, 570, 58),
      ...line([595, 410], [737, 527]),
      ...line([775, 410], [775, 512]),
      ...line([955, 410], [813, 527]),
      ...line([440, 445], [719, 556]),
    ],
    labels: [{ x: 749, y: 576, text: "DAEMON" }],
  },
  {
    day: 4,
    date: "05-12",
    rev: "0.5.22",
    note: "CODEX — A SECOND ENGINE, SAME CONTRACT",
    strokes: engine(335),
    labels: [{ x: 1234, y: 341, text: "CODEX" }],
  },
  {
    day: 17,
    date: "05-25",
    rev: "0.5.27",
    note: "GITHUB COPILOT CLI JOINS",
    strokes: engine(430),
    labels: [{ x: 1234, y: 436, text: "COPILOT" }],
  },
  {
    day: 32,
    date: "06-09",
    rev: "0.7.17",
    note: "REMOTE PROJECTS OVER SSH",
    strokes: [...dashed([717, 590], [330, 770]), ...rect(110, 720, 220, 100)],
    labels: [
      { x: 124, y: 760, text: "REMOTE HOST" },
      { x: 124, y: 790, text: "VIA SSH" },
    ],
  },
  {
    day: 34,
    date: "06-11",
    rev: "0.7.24",
    note: "A KANBAN BOARD FOR THE WHOLE FLEET",
    strokes: [
      ...rect(520, 96, 510, 120),
      ...line([520, 120], [1030, 120]),
      ...[1, 2, 3].flatMap((i) => line([520 + i * 127.5, 96], [520 + i * 127.5, 216])),
      ...[
        [0, 0],
        [0, 1],
        [1, 0],
        [2, 0],
        [2, 1],
        [3, 0],
      ].flatMap(([col, row]) => rect(532 + col * 127.5, 130 + row * 40, 104, 30)),
    ],
    labels: [{ x: 520, y: 86, text: "KANBAN" }],
  },
  {
    day: 60,
    date: "07-07",
    rev: "0.7.77",
    note: "PTY HOST — SESSIONS SURVIVE A DAEMON RESTART",
    strokes: [...line([826, 598], [900, 668]), ...rect(900, 640, 210, 86), ...hatch(1080, 640, 30, 86)],
    labels: [{ x: 914, y: 690, text: "PTY HOST" }],
  },
  {
    day: 97,
    date: "08-13",
    rev: "0.8.90",
    note: "KOBE IS RENAMED ROVE",
    strokes: line([1466, 921], [1570, 907]),
    labels: [],
    sheet: true,
  },
  {
    day: 130,
    date: "09-15",
    rev: "0.9.201",
    note: "ROVE.RUN — THE SITE BECOMES THIS SHEET",
    strokes: [
      ...rect(1160, 560, 250, 170),
      ...rect(1168, 568, 234, 154),
      ...rect(1312, 684, 84, 32),
      ...rect(1190, 590, 34, 34),
      ...rect(1236, 590, 34, 34),
      ...circle(1255, 660, 18),
      ...line([1207, 624], [1255, 642]),
    ],
    labels: [{ x: 1160, y: 754, text: "ROVE.RUN" }],
  },
  {
    day: LAST_DAY,
    date: "09-22",
    rev: "0.9.223",
    note: "TODAY — 3,358 COMMITS, STILL INKING",
    // Scallops bulge ~15px outward; keep them inside the viewport clip.
    strokes: cloud(90, 70, 1330, 750),
    labels: [],
  },
]

// Labels are lettered at 15px with 2px tracking; 9.5px a character is generous on purpose.
const labelBox = (l: Label): Box => [l.x, l.y - 15, l.x + l.text.length * 9.5, l.y + 3]
const CAMERAS = framings(
  PARTS.map((p) => (p.sheet ? null : p.labels.reduce((box, l) => union(box, labelBox(l)), strokesBox(p.strokes)))),
)

const START_FRAMES = PARTS.map((_, i) => partStart(i))
const DAYS = PARTS.map((p) => p.day)

const dayToX = (d: number) => 100 + (d / LAST_DAY) * 1300
const frameAtDay = (d: number) => interpolate(d, DAYS, START_FRAMES)

const commitsAt = (d: number) => {
  let total = 0
  MONTHS.forEach((m, i) => {
    const end = MONTHS[i + 1]?.day ?? LAST_DAY
    total += m.commits * Math.min(1, Math.max(0, (d - m.day) / (end - m.day)))
  })
  return Math.round(total)
}

const SHEET_FRAME: Stroke[] = [
  ...rect(30, 30, 1860, 1020),
  ...line([1450, 30], [1450, 1050]),
  ...line([30, 870], [1450, 870]),
  ...line([1450, 870], [1890, 870]),
]
const TABLE_RULES: Stroke[] = [...line([1450, 128], [1890, 128])]
const AXIS: Stroke[] = [
  ...line([100, 1000], [1400, 1000]),
  ...[...MONTHS.map((m) => m.day), LAST_DAY].flatMap((d) => line([dayToX(d), 994], [dayToX(d), 1006])),
]
const TITLE_RULES: Stroke[] = [
  ...line([1450, 966], [1890, 966]),
  ...[1590, 1730].flatMap((x) => line([x, 966], [x, 1050])),
]
const BARS = MONTHS.map((m, i) => {
  const x0 = dayToX(m.day) + 3
  const x1 = dayToX(MONTHS[i + 1]?.day ?? LAST_DAY) - 3
  const h = (m.commits / 843) * 78
  return [...rect(x0, 1000 - h, x1 - x0, h), ...hatch(x0, 1000 - h, x1 - x0, h, 8)]
})

export const RoveLife: React.FC<{ theme?: LifeTheme }> = ({ theme = "plot" }) => {
  const frame = useCurrentFrame()
  const c = SHEETS[theme]
  const day = interpolate(frame, START_FRAMES, DAYS, { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  const current = PARTS.reduce((acc, p, i) => (frame >= partStart(i) ? i : acc), -1)
  const cursorX = dayToX(day)
  const renamed = frame >= partStart(RENAME_PART) + DRAW * 0.5
  const tech = (size: number, color: string = c.ink, weight = 500) => ({ family: TECH, size, color, weight })
  const cam = cameraAt(frame, CAMERAS)
  const partInk = (part: Part, from: number, zoom?: number) => {
    const settle = interpolate(frame, [from + DRAW + 10, from + DRAW + 40], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
    return (
      <>
        <Ink strokes={part.strokes} from={from} dur={DRAW} color={c.ink} width={1.8} showPen={false} zoom={zoom} />
        <Ink strokes={part.strokes} from={from} dur={DRAW} color={c.accent} width={1.9} opacity={settle} zoom={zoom} />
        {part.labels.map((l) => (
          <Letter key={l.text} x={l.x} y={l.y} text={l.text} from={from + 18} {...tech(15, c.ink2)} spacing={2} />
        ))}
      </>
    )
  }

  return (
    <AbsoluteFill style={{ backgroundColor: c.paper }}>
      {/* Generated by scripts/life-score.ts from ./timeline — run `bun run score:life` first. */}
      <Html5Audio src={staticFile("life/score.wav")} />
      <svg width={LIFE.width} height={LIFE.height} viewBox={`0 0 ${LIFE.width} ${LIFE.height}`}>
        <defs>
          <clipPath id="field">
            <rect x={FIELD.x} y={FIELD.y} width={FIELD.w} height={FIELD.h} />
          </clipPath>
        </defs>
        {/* The field: model-space grid and parts, zoomed by the camera; lineweights stay plotted. */}
        <g clipPath="url(#field)">
          <g transform={viewTransform(cam)}>
            <g stroke={c.rule} strokeWidth={0.6} opacity={0.45}>
              {Array.from({ length: 35 }, (_, i) => (
                <line key={`v${i}`} x1={60 + i * 40} y1={40} x2={60 + i * 40} y2={860} vectorEffect="non-scaling-stroke" />
              ))}
              {Array.from({ length: 21 }, (_, i) => (
                <line key={`h${i}`} x1={40} y1={60 + i * 40} x2={1440} y2={60 + i * 40} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
            {PARTS.map((part, i) => (part.sheet ? null : <g key={part.date}>{partInk(part, partStart(i), cam.s)}</g>))}
          </g>
        </g>
        {frame >= 44 ? (
          <text
            x={FIELD.x + FIELD.w - 8}
            y={FIELD.y + FIELD.h - 10}
            textAnchor="end"
            fill={c.ink3}
            fontFamily={TECH}
            fontSize={13}
            letterSpacing={2}
          >
            {`VIEWPORT · SCALE ${cam.s.toFixed(2)} : 1`}
          </text>
        ) : null}

        <Ink strokes={SHEET_FRAME} from={0} dur={40} color={c.ink} width={2.2} />
        <Ink strokes={TABLE_RULES} from={24} dur={14} color={c.ink2} width={1.2} showPen={false} />
        <Ink strokes={AXIS} from={28} dur={20} color={c.ink2} width={1.4} />
        <Ink strokes={TITLE_RULES} from={30} dur={18} color={c.ink2} width={1.2} showPen={false} />

        <Letter x={1470} y={76} text="REVISIONS" from={20} {...tech(22, c.ink, 700)} spacing={3} />
        {[
          { x: 1470, t: "REV" },
          { x: 1510, t: "DATE" },
          { x: 1580, t: "VERSION" },
        ].map((h) => (
          <Letter key={h.t} x={h.x} y={116} text={h.t} from={26} {...tech(13, c.ink3)} spacing={2} />
        ))}
        {MONTHS.map((m) => (
          <Letter
            key={m.name}
            x={dayToX(m.day) + 6}
            y={1030}
            text={m.name}
            from={36}
            {...tech(14, c.ink3)}
            spacing={2}
          />
        ))}
        <Letter x={100} y={900} text="COMMITS / MONTH" from={36} {...tech(13, c.ink3)} spacing={2} />

        {BARS.map((bar, i) => (
          <Ink
            key={MONTHS[i].name}
            strokes={bar}
            from={frameAtDay(MONTHS[i].day)}
            dur={46}
            color={c.ink3}
            width={1}
            showPen={false}
          />
        ))}

        {PARTS.map((part, i) => {
          const from = partStart(i)
          const rowY = 158 + i * 64
          return (
            <g key={part.date}>
              {part.sheet ? partInk(part, from) : null}
              <Ink
                strokes={triangle(1482, rowY - 5, 11)}
                from={from}
                dur={10}
                color={c.accent}
                width={1.4}
                showPen={false}
              />
              <Letter
                x={1482}
                y={rowY - 1}
                text={String(i + 1)}
                from={from + 8}
                anchor="middle"
                {...tech(11, c.accent, 700)}
              />
              <Letter x={1510} y={rowY} text={part.date} from={from + 4} family={MONO} size={15} color={c.ink} />
              <Letter x={1580} y={rowY} text={part.rev} from={from + 6} family={MONO} size={15} color={c.ink2} />
              <Letter
                x={1510}
                y={rowY + 22}
                text={part.note}
                from={from + 12}
                cps={60}
                family={MONO}
                size={11.5}
                color={c.ink2}
              />
            </g>
          )
        })}

        {/* Title block. The name is struck and re-lettered at the rename revision. */}
        <Letter x={1468} y={930} text="KOBE" from={34} {...tech(46, renamed ? c.ink3 : c.ink, 700)} spacing={4} />
        <Letter x={1600} y={930} text="ROVE" from={RELETTER} {...tech(46, c.ink, 700)} spacing={4} />
        <Letter x={1468} y={955} text="A LIFE, DRAWN WITH ITS OWN PEN" from={40} {...tech(14, c.ink2)} spacing={2} />
        {[
          { x: 1468, k: "DAY", v: current < 0 ? "" : String(Math.floor(day)) },
          { x: 1608, k: "VERSION", v: current < 0 ? "" : PARTS[current].rev },
          { x: 1748, k: "COMMITS", v: current < 0 ? "" : commitsAt(day).toLocaleString("en-US") },
        ].map((cell) => (
          <g key={cell.k}>
            <Letter x={cell.x} y={990} text={cell.k} from={44} {...tech(12, c.ink3)} spacing={2} />
            <text x={cell.x} y={1030} fill={c.ink} fontFamily={MONO} fontSize={26} fontWeight={500}>
              {cell.v}
            </text>
          </g>
        ))}

        {current >= 0 ? (
          <g>
            <line x1={cursorX} y1={912} x2={cursorX} y2={1010} stroke={c.accent} strokeWidth={1.6} />
            <text
              x={cursorX + (cursorX > 1300 ? -6 : 6)}
              y={922}
              textAnchor={cursorX > 1300 ? "end" : "start"}
              fill={c.accent}
              fontFamily={MONO}
              fontSize={13}
            >
              {`DAY ${Math.floor(day)}`}
            </text>
          </g>
        ) : null}

        <Letter
          x={100}
          y={858}
          text={`${LAST_DAY} DAYS · ${TOTAL_COMMITS.toLocaleString("en-US")} COMMITS · NO IMAGES, NO SAMPLES — EVERY LINE AND NOTE IS CODE`}
          from={partStart(10) + DRAW}
          cps={50}
          {...tech(16, c.accent, 700)}
          spacing={2}
        />
      </svg>
    </AbsoluteFill>
  )
}
