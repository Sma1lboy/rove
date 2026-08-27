import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion"
import { colors, monoStack } from "./colors"

// Concept 1 — Bracket Chip [ rove ]
// Supported engines arrive as terminal tabs on one rail, then converge on Rove.

const agents = [
  { label: "CLAUDE", file: "claude.svg", x: 260, targetX: 650 },
  { label: "CODEX", file: "codex.svg", x: 620, targetX: 750 },
  { label: "COPILOT", file: "copilot.svg", x: 980, targetX: 850 },
  { label: "KIMI", file: "kimi.svg", x: 1340, targetX: 950 },
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
    inverse ** 3 * 280 +
    3 * inverse ** 2 * progress * 220 +
    3 * inverse * progress ** 2 * 246 +
    progress ** 3 * 192

  return { x, y }
}

const AgentFlows: React.FC<{ frame: number }> = ({ frame }) => {
  const reveal = interpolate(frame, [2, 18], [0, 1], clamp)
  const flowOpacity = interpolate(frame, [14, 22], [0, 1], clamp)

  return (
    <AbsoluteFill aria-hidden style={{ overflow: "hidden" }}>
      <svg width="1600" height="400" viewBox="0 0 1600 400" style={{ position: "absolute", inset: 0 }}>
        {agents.map((agent, index) => {
          const path = `M ${agent.x} 280 C ${agent.x} 220 ${agent.targetX} 246 ${agent.targetX} 192`
          const flowFrame = Math.max(0, frame - 18)

          return (
            <g key={agent.label}>
              <path
                d={path}
                fill="none"
                stroke={colors.blue}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="7 12"
                strokeDashoffset={-flowFrame * 0.8}
                opacity={reveal * 0.48}
              />
              {[0, 0.5].map((phase) => {
                const progress = ((flowFrame / 48 + index * 0.13 + phase) % 1 + 1) % 1
                const point = pointOnCurve(agent.x, agent.targetX, progress)
                const edgeFade = Math.min(progress / 0.12, (1 - progress) / 0.1, 1)

                return (
                  <circle
                    key={phase}
                    cx={point.x}
                    cy={point.y}
                    r={phase === 0 ? 5 : 3.5}
                    fill={colors.blue}
                    opacity={flowOpacity * edgeFade}
                  />
                )
              })}
            </g>
          )
        })}
      </svg>

      {agents.map((agent) => {
        return (
          <div
            key={agent.label}
            style={{
              position: "absolute",
              left: agent.x - 85,
              top: 280,
              width: 170,
              height: 54,
              display: "flex",
              alignItems: "center",
              gap: 13,
              padding: "0 17px",
              boxSizing: "border-box",
              backgroundColor: colors.bgSoft,
              border: `2px solid ${colors.border}`,
              boxShadow: "0 5px 0 rgba(59, 50, 42, 0.025)",
              opacity: reveal,
              translate: `0 ${8 * (1 - reveal)}px`,
            }}
          >
            <Img
              src={staticFile(`agent-logos/${agent.file}`)}
              alt=""
              style={{ width: 27, height: 27, objectFit: "contain", opacity: 0.84 }}
            />
            <span style={{ color: colors.fg, fontSize: 16, fontWeight: 700, letterSpacing: 1.4 }}>{agent.label}</span>
          </div>
        )
      })}
    </AbsoluteFill>
  )
}

export const BracketChip: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const leftBracket = spring({ frame: frame - 4, fps, config: { damping: 12, stiffness: 180 } })
  const rightBracket = spring({ frame: frame - 10, fps, config: { damping: 12, stiffness: 180 } })

  const word = "rove"
  const typeStart = 12
  const perChar = 5
  const chars = Math.max(0, Math.floor((frame - typeStart) / perChar))
  const typed = word.slice(0, Math.min(chars, word.length))

  const cursorOn = Math.floor(frame / 12) % 2 === 0 && frame > typeStart

  const leftX = interpolate(leftBracket, [0, 1], [-60, 0])
  const rightX = interpolate(rightBracket, [0, 1], [60, 0])
  const leftOpacity = interpolate(leftBracket, [0, 1], [0, 1])
  const rightOpacity = interpolate(rightBracket, [0, 1], [0, 1])

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, fontFamily: monoStack }}>
      <AgentFlows frame={frame} />
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
        <span style={{ color: colors.blue, translate: `${leftX}px 0`, opacity: leftOpacity }}>[</span>
        <span style={{ minWidth: 300, textAlign: "center", display: "inline-block" }}>
          <span>{typed}</span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 84,
              marginLeft: 6,
              verticalAlign: "middle",
              background: colors.green,
              opacity: cursorOn ? 1 : 0,
            }}
          />
        </span>
        <span style={{ color: colors.blue, translate: `${rightX}px 0`, opacity: rightOpacity }}>]</span>
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
