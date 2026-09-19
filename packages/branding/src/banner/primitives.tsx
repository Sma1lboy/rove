import type { CSSProperties } from "react"
import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion"
import { colors, isDark, monoStack } from "../colors"

// Shared parts for the README banner options. The engine marks are a
// credentials row here, not the subject: one size, one ink, no rotation.

export const BANNER = { width: 1600, height: 400, fps: 30, durationInFrames: 120 } as const

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const

/**
 * The engine marks a Rove task can drive.
 *
 * `optical` is per-mark: the SVGs draw at very different densities (a 96-unit
 * copilot blob next to a 24-unit Kimi glyph), so matching bounding boxes makes
 * the row read as though one mark were bold and another faint. These sizes
 * equalise apparent weight instead.
 */
export const ENGINES = [
  { id: "claude", file: "claude.svg", optical: 30 },
  { id: "codex", file: "codex.svg", optical: 27 },
  { id: "copilot", file: "copilot.svg", optical: 26 },
  { id: "kimi", file: "kimi.svg", optical: 23 },
] as const

/** Slot every mark centres inside, so the row keeps a constant pitch. */
export const SLOT = 30
export const SLOT_GAP = 34
export const SLOT_PITCH = SLOT + SLOT_GAP

const monoInk = isDark ? "brightness(0) invert(1)" : "brightness(0)"

export type MarkVariant = "mono" | "color"

/**
 * Resting ink for a credentials row. Mono marks are flattened silhouettes and
 * carry more apparent weight per pixel than the vendor colours do, so they need
 * the lighter value to land at the same perceived strength.
 */
export const RESTING_INK = { mono: 0.5, color: 0.78 } as const

/**
 * One engine mark. `mono` flattens the vendor's own palette to a single ink
 * (the SVGs carry `#D97757`, `#000`, `#1783FF`), so four brands read as one
 * row instead of four competing accents; `weight` is that ink's strength.
 */
export const EngineMark: React.FC<{
  file: string
  size: number
  variant: MarkVariant
  weight: number
  style?: CSSProperties
}> = ({ file, size, variant, weight, style }) => (
  <Img
    src={staticFile(`agent-logos/${file}`)}
    alt=""
    style={{
      width: size,
      height: size,
      objectFit: "contain",
      opacity: weight,
      filter: variant === "mono" ? monoInk : undefined,
      ...style,
    }}
  />
)

/** `[ rove ]`, brackets closing over the letters as the letters rise into place. */
export const Wordmark: React.FC<{ top: number; startFrame?: number; fontSize?: number }> = ({
  top,
  startFrame = 2,
  fontSize = 112,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = spring({ frame: frame - startFrame, fps, config: { damping: 18, stiffness: 130 } })
  const letterWidth = fontSize * 0.643
  const bracketGap = interpolate(enter, [0, 1], [letterWidth, 0], clamp)
  const blockOpacity = interpolate(frame, [startFrame, startFrame + 6], [0, 1], clamp)

  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 0,
        width: "100%",
        height: fontSize * 1.14,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: fontSize * 0.16,
        fontSize,
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: -3,
        color: colors.fg,
        opacity: blockOpacity,
      }}
    >
      <span style={{ color: colors.blue, transform: `translateX(${-bracketGap}px)` }}>[</span>
      <span style={{ display: "flex", width: letterWidth * 4 }}>
        {["r", "o", "v", "e"].map((letter, index) => {
          const p = interpolate(frame, [startFrame + 3 + index * 2, startFrame + 13 + index * 2], [0, 1], clamp)
          return (
            <span
              key={letter}
              style={{
                width: letterWidth,
                textAlign: "center",
                opacity: p,
                transform: `translateY(${(1 - p) * 16}px)`,
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

/** Small-tracked caps — the credential-block eyebrow, as in the reference. */
export const CapsLabel: React.FC<{ text: string; top: number; opacity?: number }> = ({
  text,
  top,
  opacity = 1,
}) => (
  <div
    style={{
      position: "absolute",
      top,
      left: 0,
      width: "100%",
      textAlign: "center",
      fontFamily: monoStack,
      fontSize: 12,
      fontWeight: 500,
      letterSpacing: 5,
      color: colors.muted,
      opacity,
    }}
  >
    {text}
  </div>
)

export const Slogan: React.FC<{ opacity: number }> = ({ opacity }) => (
  <div
    style={{
      position: "absolute",
      bottom: 26,
      left: 0,
      width: "100%",
      textAlign: "center",
      fontFamily: monoStack,
      fontSize: 16,
      letterSpacing: 4.5,
      color: colors.muted,
      opacity,
    }}
  >
    THE AGENT MULTIPLEXER IN YOUR SHELL
  </div>
)

/** Scene-level fade so the GIF loops cleanly at both ends. */
export const useSceneOpacity = () => {
  const frame = useCurrentFrame()
  return interpolate(frame, [0, 5, 108, 119], [0, 1, 1, 0], clamp)
}

/** x of each slot's centre once a row of `SLOT_PITCH` slots is centred on the canvas. */
export const slotCenterX = (index: number) => {
  const rowWidth = ENGINES.length * SLOT + (ENGINES.length - 1) * SLOT_GAP
  return (BANNER.width - rowWidth) / 2 + index * SLOT_PITCH + SLOT / 2
}

export const rowStyle: CSSProperties = {
  position: "absolute",
  top: 240,
  left: 0,
  width: "100%",
  display: "flex",
  justifyContent: "center",
  gap: SLOT_GAP,
}

export const slotStyle: CSSProperties = {
  width: SLOT,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
}