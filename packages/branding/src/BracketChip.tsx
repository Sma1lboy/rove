import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion"
import { colors, monoStack } from "./colors"

// Concept 1 — Bracket Chip [ rove ]
// Supported engines arrive as terminal tabs on one rail, then converge on Rove.

const agents = [
  { label: "CLAUDE", file: "claude.svg", x: 260 },
  { label: "CODEX", file: "codex.svg", x: 620 },
  { label: "COPILOT", file: "copilot.svg", x: 980 },
  { label: "KIMI", file: "kimi.svg", x: 1340 },
] as const

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const

const AgentRail: React.FC<{ frame: number }> = ({ frame }) => {
  const railProgress = interpolate(frame, [2, 24], [0, 1], clamp)

  return (
    <AbsoluteFill aria-hidden style={{ overflow: "hidden" }}>
      <svg width="1600" height="400" viewBox="0 0 1600 400" style={{ position: "absolute", inset: 0 }}>
        <path
          d="M 800 220 V 258 H 170 M 800 258 H 1430"
          fill="none"
          stroke={colors.border}
          strokeWidth="2"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - railProgress}
        />
        {agents.map((agent, index) => {
          const start = 4 + index * 8
          const progress = interpolate(frame, [start, start + 14], [0, 1], clamp)

          return (
            <g key={agent.label}>
              <path
                d={`M ${agent.x} 280 V 258 H 800 V 220`}
                fill="none"
                stroke={colors.blue}
                strokeWidth="2"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - progress}
                opacity={0.18 + progress * 0.55}
              />
              <circle cx={agent.x} cy="258" r="4" fill={colors.bg} stroke={colors.blue} strokeWidth="2" opacity={progress} />
            </g>
          )
        })}
        <circle cx="800" cy="220" r="5" fill={colors.blue} opacity={railProgress} />
      </svg>

      {agents.map((agent, index) => {
        const start = 4 + index * 8
        const reveal = interpolate(frame, [start, start + 10], [0, 1], clamp)
        const pulse = interpolate(frame, [start + 3, start + 7, start + 13], [0, 1, 0], clamp)

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
              border: `2px solid ${pulse > 0.2 ? colors.blue : colors.border}`,
              boxShadow: `0 5px 0 rgba(59, 50, 42, ${0.025 + pulse * 0.035})`,
              opacity: reveal,
              translate: `0 ${8 * (1 - reveal)}px`,
            }}
          >
            <Img
              src={staticFile(`agent-logos/${agent.file}`)}
              alt=""
              style={{ width: 27, height: 27, objectFit: "contain", opacity: 0.74 + pulse * 0.26 }}
            />
            <span style={{ color: colors.fg, fontSize: 16, fontWeight: 700, letterSpacing: 1.4 }}>{agent.label}</span>
            <span
              style={{
                width: 6,
                height: 6,
                marginLeft: "auto",
                borderRadius: "50%",
                backgroundColor: colors.green,
                opacity: 0.35 + pulse * 0.65,
              }}
            />
          </div>
        )
      })}
    </AbsoluteFill>
  )
}

export const BracketChip: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const leftBracket = spring({ frame: frame - 34, fps, config: { damping: 12, stiffness: 180 } })
  const rightBracket = spring({ frame: frame - 40, fps, config: { damping: 12, stiffness: 180 } })

  const word = "rove"
  const typeStart = 48
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
      <AgentRail frame={frame} />
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
