import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion"
import { colors, monoStack } from "./colors"
import {
  CapsLabel,
  clamp,
  EngineMark,
  ENGINES,
  RESTING_INK,
  Slogan,
  useSceneOpacity,
  Wordmark,
} from "./banner/primitives"

// Option 3 — "Relay rail".
// The marks hang off a full-width hairline at their own resting weights; one
// accent node runs the rail and lights each engine as it passes. Uses the whole
// 1600px instead of clustering at the centre, and the marks never move or rotate.

const RAIL_Y = 268
const RAIL_LEFT = 320
const RAIL_RIGHT = 1280
const RAIL_WIDTH = RAIL_RIGHT - RAIL_LEFT
const NODE_START = 18
const NODE_END = 102
/** How close the node has to be before an engine is fully lit. */
const LIT_RADIUS = 96

const railX = (index: number) => RAIL_LEFT + (index * RAIL_WIDTH) / (ENGINES.length - 1)

export const BannerRelay: React.FC = () => {
  const frame = useCurrentFrame()
  const sceneOpacity = useSceneOpacity()
  const rail = interpolate(frame, [10, 30], [0, 1], clamp)
  const nodeX = interpolate(frame, [NODE_START, NODE_END], [RAIL_LEFT, RAIL_RIGHT], clamp)
  const nodeOpacity = interpolate(
    frame,
    [NODE_START - 2, NODE_START + 4, NODE_END, NODE_END + 6],
    [0, 1, 1, 0],
    clamp,
  )

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg, fontFamily: monoStack }}>
      <AbsoluteFill style={{ opacity: sceneOpacity }}>
        <Wordmark top={44} />

        <CapsLabel text="COMPATIBLE" top={208} opacity={interpolate(frame, [10, 24], [0, 0.9], clamp)} />

        <div
          style={{
            position: "absolute",
            top: RAIL_Y,
            left: RAIL_LEFT,
            width: RAIL_WIDTH,
            height: 1,
            background: colors.border,
            transform: `scaleX(${rail})`,
            transformOrigin: "left center",
          }}
        />

        <div
          style={{
            position: "absolute",
            top: RAIL_Y - 2,
            left: nodeX - 70,
            width: 140,
            height: 5,
            borderRadius: 3,
            background: `linear-gradient(90deg, transparent, ${colors.blue})`,
            opacity: nodeOpacity,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: RAIL_Y - 4,
            left: nodeX - 4,
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: colors.blue,
            opacity: nodeOpacity,
          }}
        />

        {ENGINES.map((engine, index) => {
          const lit = interpolate(Math.abs(nodeX - railX(index)), [0, LIT_RADIUS], [1, 0], clamp)
          const appear = interpolate(frame, [8 + index * 3, 22 + index * 3], [0, 1], clamp)
          const size = engine.optical
          return (
            <EngineMark
              key={engine.id}
              file={engine.file}
              size={size}
              variant="mono"
              weight={(RESTING_INK.mono + (1 - RESTING_INK.mono) * lit * nodeOpacity) * appear}
              style={{
                position: "absolute",
                left: railX(index) - size / 2,
                top: RAIL_Y - size / 2,
                transform: `scale(${1 + lit * 0.18})`,
              }}
            />
          )
        })}

        <Slogan opacity={1} />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}