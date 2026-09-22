import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion"
import { colors, monoStack } from "./colors"
import {
  BANNER,
  CapsLabel,
  clamp,
  EngineMark,
  ENGINES,
  RESTING_INK,
  rowStyle,
  Slogan,
  slotStyle,
  useSceneOpacity,
  Wordmark,
} from "./banner/primitives"

// Option 1 — "Quiet strip".
// The marks are read, not watched: one row, one size, one ink, no rotation and
// no per-mark movement beyond a staggered fade-up. The single living element is
// the accent rule that draws itself under the row. Closest to the reference.

export const BannerQuiet: React.FC<{ variant?: "mono" | "color" }> = ({ variant = "mono" }) => {
  const frame = useCurrentFrame()
  const sceneOpacity = useSceneOpacity()
  const rule = interpolate(frame, [34, 58], [0, 1], clamp)

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, fontFamily: monoStack }}>
      <AbsoluteFill style={{ opacity: sceneOpacity }}>
        <Wordmark top={44} />

        <CapsLabel text="COMPATIBLE" top={208} opacity={interpolate(frame, [10, 24], [0, 0.9], clamp)} />

        <div style={rowStyle}>
          {ENGINES.map((engine, index) => {
            const p = interpolate(frame, [14 + index * 4, 30 + index * 4], [0, 1], clamp)
            return (
              <div key={engine.id} style={slotStyle}>
                <EngineMark
                  file={engine.file}
                  size={engine.optical}
                  variant={variant}
                  weight={RESTING_INK[variant] * p}
                  style={{ transform: `translateY(${(1 - p) * 8}px)` }}
                />
              </div>
            )
          })}
        </div>

        <div
          style={{
            position: "absolute",
            top: 300,
            left: BANNER.width / 2 - 100,
            width: 200,
            height: 2,
            background: colors.blue,
            transform: `scaleX(${rule})`,
          }}
        />

        <Slogan opacity={1} />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}