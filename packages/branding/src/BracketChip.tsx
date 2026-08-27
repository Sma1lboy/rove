import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion"
import { colors, monoStack } from "./colors"

// Concept 1 — Bracket Chip [ rove ]
// Supported engine marks travel directly into the letters of the Rove wordmark.

const agents = [
  { id: "claude", file: "claude.svg", startX: 260, targetX: 688, size: 54 },
  { id: "codex", file: "codex.svg", startX: 620, targetX: 763, size: 52 },
  { id: "copilot", file: "copilot.svg", startX: 980, targetX: 838, size: 56 },
  { id: "kimi", file: "kimi.svg", startX: 1340, targetX: 913, size: 52 },
] as const

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const

const pointOnCurve = (startX: number, endX: number, progress: number) => {
  const inverse = 1 - progress
  const control1X = startX
  const control2X = endX
  const x =
    inverse ** 3 * startX +
    3 * inverse ** 2 * progress * control1X +
    3 * inverse * progress ** 2 * control2X +
    progress ** 3 * endX
  const y =
    inverse ** 3 * 294 +
    3 * inverse ** 2 * progress * 238 +
    3 * inverse * progress ** 2 * 214 +
    progress ** 3 * 126

  return { x, y }
}

const MovingAgentIcons: React.FC<{ frame: number }> = ({ frame }) => {
  return (
    <AbsoluteFill aria-hidden style={{ overflow: "hidden" }}>
      <svg width="1600" height="400" viewBox="0 0 1600 400" style={{ position: "absolute", inset: 0 }}>
        {agents.map((agent, index) => {
          const start = 12 + index * 6
          const progress = interpolate(frame, [start, start + 40], [0, 1], {
            ...clamp,
            easing: Easing.inOut(Easing.cubic),
          })
          const trailOpacity = interpolate(progress, [0, 0.08, 0.82, 1], [0, 0.28, 0.28, 0], clamp)

          return (
            <path
              key={agent.id}
              d={`M ${agent.startX} 294 C ${agent.startX} 238 ${agent.targetX} 214 ${agent.targetX} 126`}
              fill="none"
              stroke={colors.blue}
              strokeWidth="2"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - progress}
              opacity={trailOpacity}
            />
          )
        })}
      </svg>

      {agents.map((agent, index) => {
        const start = 12 + index * 6
        const progress = interpolate(frame, [start, start + 40], [0, 1], {
          ...clamp,
          easing: Easing.inOut(Easing.cubic),
        })
        const point = pointOnCurve(agent.startX, agent.targetX, progress)
        const returnOpacity = interpolate(frame, [92, 112], [0, 1], clamp)
        const movingOpacity = interpolate(progress, [0, 0.82, 1], [1, 1, 0], clamp)
        const isReturning = frame >= 92
        const x = isReturning ? agent.startX : point.x
        const y = isReturning ? 294 : point.y
        const scale = isReturning ? 1 : interpolate(progress, [0, 0.7, 1], [1, 0.88, 0.2], clamp)

        return (
          <Img
            key={agent.id}
            src={staticFile(`agent-logos/${agent.file}`)}
            alt=""
            style={{
              position: "absolute",
              left: x - agent.size / 2,
              top: y - agent.size / 2,
              width: agent.size,
              height: agent.size,
              objectFit: "contain",
              opacity: isReturning ? returnOpacity : movingOpacity,
              scale,
            }}
          />
        )
      })}
    </AbsoluteFill>
  )
}

export const BracketChip: React.FC = () => {
  const frame = useCurrentFrame()

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, fontFamily: monoStack }}>
      <MovingAgentIcons frame={frame} />
      <div
        style={{
          position: "absolute",
          top: 56,
          left: 0,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          fontSize: 112,
          fontWeight: 700,
          letterSpacing: -3,
          color: colors.fg,
        }}
      >
        <span style={{ color: colors.blue }}>[</span>
        <span style={{ minWidth: 300, textAlign: "center", display: "inline-block" }}>
          <span>rove</span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 84,
              marginLeft: 6,
              verticalAlign: "middle",
              background: colors.green,
              opacity: 1,
            }}
          />
        </span>
        <span style={{ color: colors.blue }}>]</span>
      </div>
      <div
        style={{
          position: "absolute",
          top: 352,
          width: "100%",
          textAlign: "center",
          color: colors.muted,
          fontSize: 17,
          letterSpacing: 4.5,
        }}
      >
        THE AGENT MULTIPLEXER IN YOUR SHELL
      </div>
    </AbsoluteFill>
  )
}
