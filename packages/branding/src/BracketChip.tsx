import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion"
import { colors, monoStack } from "./colors"

// Concept 1 — Bracket Chip [ rove ]
// Supported engine marks travel directly into the letters of the Rove wordmark.

const agents = [
  { id: "claude", file: "claude.svg", startX: 320, targetX: 692, size: 54 },
  { id: "codex", file: "codex.svg", startX: 640, targetX: 764, size: 52 },
  { id: "copilot", file: "copilot.svg", startX: 960, targetX: 836, size: 56 },
  { id: "kimi", file: "kimi.svg", startX: 1280, targetX: 908, size: 52 },
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
    inverse ** 3 * 286 +
    3 * inverse ** 2 * progress * 232 +
    3 * inverse * progress ** 2 * 196 +
    progress ** 3 * 116

  return { x, y }
}

const MovingAgentIcons: React.FC<{ progress: number }> = ({ progress }) => {
  return (
    <AbsoluteFill aria-hidden style={{ overflow: "hidden" }}>
      <svg width="1600" height="400" viewBox="0 0 1600 400" style={{ position: "absolute", inset: 0 }}>
        {agents.map((agent) => {
          const trailOpacity = interpolate(progress, [0, 0.08, 0.82, 1], [0, 0.28, 0.28, 0], clamp)

          return (
            <path
              key={agent.id}
              d={`M ${agent.startX} 286 C ${agent.startX} 232 ${agent.targetX} 196 ${agent.targetX} 116`}
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

      {agents.map((agent) => {
        const point = pointOnCurve(agent.startX, agent.targetX, progress)
        const movingOpacity = interpolate(progress, [0, 0.82, 1], [1, 1, 0], clamp)
        const scale = interpolate(progress, [0, 0.7, 1], [1, 0.88, 0.2], clamp)

        return (
          <Img
            key={agent.id}
            src={staticFile(`agent-logos/${agent.file}`)}
            alt=""
            style={{
              position: "absolute",
              left: point.x - agent.size / 2,
              top: point.y - agent.size / 2,
              width: agent.size,
              height: agent.size,
              objectFit: "contain",
              opacity: movingOpacity,
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
  const { fps } = useVideoConfig()
  const leftBracket = spring({ frame: frame - 2, fps, config: { damping: 12, stiffness: 180 } })
  const rightBracket = spring({ frame: frame - 6, fps, config: { damping: 12, stiffness: 180 } })
  const sharedProgress = interpolate(frame, [8, 56], [0, 1], clamp)
  const typedCount = frame < 8 ? 0 : Math.min(4, Math.floor(sharedProgress * 4) + 1)
  const cursorOn = frame > 8 && Math.floor(frame / 10) % 2 === 0
  const sceneOpacity = interpolate(frame, [0, 6, 104, 119], [0, 1, 1, 0], clamp)
  const impactScale = interpolate(frame, [56, 60, 68], [1, 1.045, 1], clamp)
  const leftX = interpolate(leftBracket, [0, 1], [-52, 0])
  const rightX = interpolate(rightBracket, [0, 1], [52, 0])

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, fontFamily: monoStack }}>
      <AbsoluteFill style={{ opacity: sceneOpacity }}>
        <MovingAgentIcons progress={sharedProgress} />
        <div
          style={{
            position: "absolute",
            top: 56,
            left: 0,
            width: "100%",
            height: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
            fontSize: 112,
            lineHeight: 1,
            fontWeight: 700,
            letterSpacing: -3,
            color: colors.fg,
            scale: impactScale,
          }}
        >
          <span style={{ color: colors.blue, opacity: leftBracket, translate: `${leftX}px 0` }}>[</span>
          <span style={{ position: "relative", width: 288, height: 120, display: "flex", alignItems: "center" }}>
            {["r", "o", "v", "e"].map((letter, index) => (
              <span key={letter} style={{ width: 72, textAlign: "center", opacity: index < typedCount ? 1 : 0 }}>
                {letter}
              </span>
            ))}
            <span
              style={{
                position: "absolute",
                right: -10,
                top: 18,
                width: 10,
                height: 84,
                background: colors.green,
                opacity: cursorOn ? 1 : 0,
              }}
            />
          </span>
          <span style={{ color: colors.blue, opacity: rightBracket, translate: `${rightX}px 0` }}>]</span>
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
    </AbsoluteFill>
  )
}
