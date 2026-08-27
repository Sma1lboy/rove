import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion"
import { colors, monoStack } from "./colors"

// Concept 1 — Bracket Chip [ rove ]
// On-brand for the agent-deck "[Tab] label" hotkey grammar that runs through
// Rove's UI. Brackets snap in, "rove" types in, the cursor blinks.
// Reads as a button you can press — that's the point.

const agentMarks = [
  { label: "Claude", file: "claude.svg", x: 210, y: 171, size: 142, opacity: 0.13 },
  { label: "Codex", file: "codex.svg", x: 480, y: 153, size: 146, opacity: 0.085 },
  { label: "Copilot", file: "copilot.svg", x: 1120, y: 160, size: 142, opacity: 0.08 },
  { label: "Kimi", file: "kimi.svg", x: 1390, y: 171, size: 134, opacity: 0.1 },
] as const

const SupportedAgentBackdrop: React.FC<{ frame: number }> = ({ frame }) => (
  <AbsoluteFill aria-hidden style={{ overflow: "hidden" }}>
    {agentMarks.map((mark, index) => {
      const reveal = interpolate(frame, [2 + index * 3, 18 + index * 3], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
      const rise = interpolate(reveal, [0, 1], [12, 0])

      return (
        <Img
          key={mark.label}
          src={staticFile(`agent-logos/${mark.file}`)}
          alt=""
          style={{
            position: "absolute",
            left: mark.x - mark.size / 2,
            top: mark.y - mark.size / 2,
            width: mark.size,
            height: mark.size,
            objectFit: "contain",
            opacity: reveal * mark.opacity,
            transform: `translateY(${rise}px)`,
          }}
        />
      )
    })}
  </AbsoluteFill>
)

export const BracketChip: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const leftBracket = spring({ frame: frame - 4, fps, config: { damping: 12, stiffness: 180 } })
  const rightBracket = spring({ frame: frame - 10, fps, config: { damping: 12, stiffness: 180 } })

  const word = "rove"
  const typeStart = 22
  const perChar = 5
  const chars = Math.max(0, Math.floor((frame - typeStart) / perChar))
  const typed = word.slice(0, Math.min(chars, word.length))

  const cursorOn = Math.floor(frame / 12) % 2 === 0 && frame > typeStart

  const leftX = interpolate(leftBracket, [0, 1], [-60, 0])
  const rightX = interpolate(rightBracket, [0, 1], [60, 0])
  const leftOpacity = interpolate(leftBracket, [0, 1], [0, 1])
  const rightOpacity = interpolate(rightBracket, [0, 1], [0, 1])

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.bg,
        alignItems: "center",
        justifyContent: "center",
        fontFamily: monoStack,
      }}
    >
      <SupportedAgentBackdrop frame={frame} />
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 18,
          fontSize: 120,
          fontWeight: 700,
          letterSpacing: -3,
          color: colors.fg,
        }}
      >
        <span style={{ color: colors.blue, transform: `translateX(${leftX}px)`, opacity: leftOpacity }}>[</span>
        <span style={{ minWidth: 320, textAlign: "center", display: "inline-block" }}>
          <span>{typed}</span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 92,
              marginLeft: 6,
              verticalAlign: "middle",
              background: colors.green,
              opacity: cursorOn ? 1 : 0,
            }}
          />
        </span>
        <span style={{ color: colors.blue, transform: `translateX(${rightX}px)`, opacity: rightOpacity }}>]</span>
      </div>
      <div style={{ position: "relative", marginTop: 20, color: colors.muted, fontSize: 20, letterSpacing: 5 }}>
        THE AGENT MULTIPLEXER IN YOUR SHELL
      </div>
      <div
        style={{ position: "relative", marginTop: 10, color: colors.muted, fontSize: 14, letterSpacing: 3, opacity: 0.7 }}
      >
        CLAUDE · CODEX · COPILOT · KIMI · YOUR OWN
      </div>
    </AbsoluteFill>
  )
}
