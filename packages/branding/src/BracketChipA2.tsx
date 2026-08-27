import type { CSSProperties } from "react"
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion"
import { colors, monoStack } from "./colors"

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const

const agents = [
  { file: "claude.svg" },
  { file: "codex.svg" },
  { file: "copilot.svg" },
  { file: "kimi.svg" },
] as const

const center = { x: 800, y: 145 }
const aspect = 2.25
const captureRadius = 54
const maxSteps = 82
const physicsStartFrame = 7
const logoSize = 28

const tiles = Array.from({ length: 100 }, (_, index) => {
  const column = index % 20
  const row = Math.floor(index / 20)
  return {
    agent: agents[index % agents.length],
    column,
    row,
    x: 64 + column * (1_472 / 19),
    y: 22 + row * 65,
  }
})

type FlowState = {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  captured: boolean
}

const physicalRadius = (x: number, y: number) => Math.hypot(x - center.x, (y - center.y) * aspect)

const buildTrajectory = (tile: (typeof tiles)[number]) => {
  const initial: FlowState = {
    x: tile.x,
    y: tile.y,
    vx: (tile.row - 2) * 1.8,
    vy: (9.5 - tile.column) * 0.32,
    radius: physicalRadius(tile.x, tile.y),
    captured: false,
  }
  const trajectory = [initial]

  for (let step = 0; step < maxSteps; step += 1) {
    const previous = trajectory[trajectory.length - 1]
    if (previous.captured) {
      trajectory.push(previous)
      continue
    }

    const dx = previous.x - center.x
    const dy = (previous.y - center.y) * aspect
    const radius = Math.hypot(dx, dy)
    if (radius <= captureRadius) {
      trajectory.push({ ...previous, radius, captured: true })
      continue
    }

    const softenedRadiusSquared = dx * dx + dy * dy + 88 * 88
    let flowX = (-150_000 * dx - 78_000 * dy) / softenedRadiusSquared
    let flowY = (-150_000 * dy + 78_000 * dx) / softenedRadiusSquared / aspect
    const flowSpeed = Math.hypot(flowX, flowY)
    if (flowSpeed > 760) {
      const limiter = 760 / flowSpeed
      flowX *= limiter
      flowY *= limiter
    }

    const vx = (previous.vx + (flowX - previous.vx) * 0.24) * 0.994
    const vy = (previous.vy + (flowY - previous.vy) * 0.24) * 0.994
    const x = previous.x + vx / 30
    const y = previous.y + vy / 30
    const nextRadius = physicalRadius(x, y)
    trajectory.push({ x, y, vx, vy, radius: nextRadius, captured: nextRadius <= captureRadius })
  }

  return trajectory
}

const trajectories = tiles.map(buildTrajectory)

const AgentIcon = ({ file, style }: { file: string; style: CSSProperties }) => (
  <Img
    src={staticFile(`agent-logos/${file}`)}
    alt=""
    style={{
      position: "absolute",
      width: logoSize,
      height: logoSize,
      objectFit: "contain",
      ...style,
    }}
  />
)

const Wordmark = ({ progress }: { progress: number }) => {
  const bracketGap = interpolate(progress, [0, 1], [72, 0], clamp)
  const opacity = interpolate(progress, [0, 0.08], [0.1, 1], clamp)

  return (
    <div
      style={{
        position: "absolute",
        top: 78,
        left: 0,
        width: "100%",
        height: 126,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 18,
        color: colors.fg,
        fontFamily: monoStack,
        fontSize: 112,
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: -3,
        opacity,
      }}
    >
      <span style={{ color: colors.blue, transform: `translateX(${-bracketGap}px)` }}>[</span>
      <span style={{ width: 288, display: "flex" }}>
        {["r", "o", "v", "e"].map((letter, index) => {
          const letterProgress = interpolate(progress, [index * 0.18, index * 0.18 + 0.34], [0, 1], clamp)
          return (
            <span
              key={letter}
              style={{
                width: 72,
                textAlign: "center",
                opacity: letterProgress,
                transform: `translateY(${interpolate(letterProgress, [0, 1], [18, 0])}px)`,
              }}
            >
              {letter}
            </span>
          )
        })}
      </span>
      <span style={{ color: colors.blue, transform: `translateX(${bracketGap}px)` }}>]</span>
    </div>
  )
}

export const BracketChipA2: React.FC = () => {
  const frame = useCurrentFrame()
  const step = Math.min(maxSteps, Math.max(0, frame - physicsStartFrame))
  const previousStep = Math.max(0, step - 3)
  const samples = trajectories.map((trajectory) => trajectory[step])
  const capturedRatio = samples.filter((sample) => sample.captured).length / samples.length
  const wordmarkProgress = interpolate(capturedRatio, [0.08, 0.92], [0, 1], clamp)
  const sceneOpacity = interpolate(frame, [0, 5, 108, 119], [0, 1, 1, 0], clamp)

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, color: colors.fg, fontFamily: monoStack }}>
      <AbsoluteFill style={{ opacity: sceneOpacity, overflow: "hidden" }}>
        <svg width="1600" height="400" style={{ position: "absolute", inset: 0 }} aria-hidden>
          {samples.map((sample, index) => {
            const previous = trajectories[index][previousStep]
            const speed = Math.hypot(sample.vx, sample.vy)
            return (
              <line
                key={`trail-${index}`}
                x1={previous.x}
                y1={previous.y}
                x2={sample.x}
                y2={sample.y}
                stroke={colors.blue}
                strokeWidth={interpolate(speed, [0, 760], [0.7, 2.1], clamp)}
                strokeLinecap="round"
                opacity={sample.captured ? 0 : interpolate(speed, [0, 120, 760], [0, 0.11, 0.28], clamp)}
              />
            )
          })}
        </svg>

        {samples.map((sample, index) => {
          const tile = tiles[index]
          const speed = Math.hypot(sample.vx, sample.vy)
          const heading = Math.atan2(sample.vy, sample.vx) * (180 / Math.PI)
          const rotationStrength = interpolate(speed, [12, 160], [0, 0.22], clamp)
          return (
            <AgentIcon
              key={`${tile.column}-${tile.row}`}
              file={tile.agent.file}
              style={{
                left: sample.x - logoSize / 2,
                top: sample.y - logoSize / 2,
                opacity: sample.captured
                  ? 0
                  : interpolate(sample.radius, [captureRadius, 220, 720], [0, 0.38, 0.28], clamp),
                scale: interpolate(sample.radius, [captureRadius, 170, 720], [0.08, 0.72, 1], clamp),
                rotate: `${heading * rotationStrength}deg`,
              }}
            />
          )
        })}

        <div
          style={{
            position: "absolute",
            left: 554,
            top: 62,
            width: 492,
            height: 166,
            background: colors.bg,
            boxShadow: `0 0 50px 38px ${colors.bg}`,
            opacity: interpolate(capturedRatio, [0, 0.24], [0, 1], clamp),
          }}
        />
        <Wordmark progress={wordmarkProgress} />
      </AbsoluteFill>

      <div
        style={{
          position: "absolute",
          bottom: 26,
          width: "100%",
          textAlign: "center",
          color: colors.muted,
          fontSize: 16,
          letterSpacing: 4.5,
          opacity: sceneOpacity,
        }}
      >
        THE AGENT MULTIPLEXER IN YOUR SHELL
      </div>
    </AbsoluteFill>
  )
}
