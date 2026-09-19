import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion"
import { colors, monoStack } from "./colors"
import {
  CapsLabel,
  clamp,
  EngineMark,
  ENGINES,
  RESTING_INK,
  rowStyle,
  Slogan,
  slotCenterX,
  slotStyle,
  useSceneOpacity,
  Wordmark,
} from "./banner/primitives"

// Option 2 — "Caret step".
// The row is static and mono; a terracotta caret steps under it one engine at a
// time, lifting that mark to full ink. Motion is discrete and horizontal — the
// `[Tab] label` grammar the TUI already uses — instead of the old vortex.

/** Frames each engine holds before the caret moves on. */
const STEP = 14
/** Frames the caret spends travelling between two engines. */
const SLIDE = 7
const FIRST_STEP_FRAME = 16

const caretX = ENGINES.map((_, index) => slotCenterX(index))

export const BannerCaret: React.FC = () => {
  const frame = useCurrentFrame()
  const sceneOpacity = useSceneOpacity()
  const stepIndex = Math.min(
    ENGINES.length - 1,
    Math.max(0, Math.floor((frame - FIRST_STEP_FRAME) / STEP)),
  )
  const slideProgress = interpolate((frame - FIRST_STEP_FRAME - stepIndex * STEP) / SLIDE, [0, 1], [0, 1], clamp)
  const caretSlot = Math.max(0, stepIndex - (1 - slideProgress))
  // The lit mark is whichever slot the caret is nearest, so the handoff happens
  // mid-slide instead of the target lighting up before the caret arrives.
  const activeIndex = Math.round(caretSlot)
  const caretOpacity = interpolate(frame, [FIRST_STEP_FRAME - 4, FIRST_STEP_FRAME + 2], [0, 1], clamp)

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, fontFamily: monoStack }}>
      <AbsoluteFill style={{ opacity: sceneOpacity }}>
        <Wordmark top={44} />

        <CapsLabel text="COMPATIBLE" top={208} opacity={interpolate(frame, [10, 24], [0, 0.9], clamp)} />

        <div style={rowStyle}>
          {ENGINES.map((engine, index) => {
            const p = interpolate(frame, [12 + index * 2, 24 + index * 2], [0, 1], clamp)
            const lit = index === activeIndex ? 1 : 0
            return (
              <div key={engine.id} style={slotStyle}>
                <EngineMark
                  file={engine.file}
                  size={engine.optical}
                  variant="mono"
                  weight={(RESTING_INK.mono + (1 - RESTING_INK.mono) * lit) * p}
                  style={{ transform: `translateY(${(1 - p) * 8}px) scale(${1 + lit * 0.16})` }}
                />
              </div>
            )
          })}
        </div>

        <div
          style={{
            position: "absolute",
            top: 288,
            left: caretX[0] - 9,
            width: 18,
            height: 3,
            borderRadius: 2,
            background: colors.blue,
            opacity: caretOpacity,
            transform: `translateX(${caretSlot * (caretX[1] - caretX[0])}px)`,
          }}
        />

        <Slogan opacity={1} />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}