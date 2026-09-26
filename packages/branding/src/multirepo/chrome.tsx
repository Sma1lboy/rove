import { loadFont as loadSans } from "@remotion/google-fonts/InstrumentSans"
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono"
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"

/**
 * The film around the recording: type, palette, wallpaper, captions, the
 * `rove ⏎` keycaps and the end card. Nothing here knows the take — what the
 * window shows and when is `MultiRepoCut.tsx`.
 */

export const { fontFamily: sans } = loadSans("normal", { weights: ["500", "600", "700"] })
export const { fontFamily: mono } = loadMono("normal", { weights: ["400", "700"] })

export const INK = "#FFF8F1"
export const KEY_BG = "#1E1B19"
export const ACCENT = "#F2A57E"

/** From `at` seconds into a scene, `text` replaces the caption's kicker. */
export type KickerChange = { readonly at: number; readonly text: string }

export function Wallpaper({ frames }: { frames: number }) {
  const frame = useCurrentFrame()
  const drift = interpolate(frame, [0, frames], [0, 1])
  return (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(ellipse 60% 55% at ${78 - drift * 10}% ${22 + drift * 6}%, rgba(255,224,196,0.55), rgba(255,224,196,0) 70%)`,
          `radial-gradient(ellipse 70% 60% at ${12 + drift * 8}% 95%, rgba(120,40,30,0.55), rgba(120,40,30,0) 70%)`,
          "linear-gradient(165deg, #4A3150 0%, #93445A 26%, #CF6A4A 55%, #E48A5E 74%, #B8523B 100%)",
        ].join(","),
      }}
    />
  )
}

export function Caption({
  text,
  kicker: firstKicker,
  kickerChanges = [],
  frames,
}: {
  text: string
  kicker?: string
  kickerChanges?: readonly KickerChange[]
  frames: number
}) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // The kicker in force now, and a short fade in after each change.
  const change = [...kickerChanges].reverse().find((c) => frame >= c.at * fps)
  const kicker = change?.text ?? firstKicker
  const kickerIn = change
    ? interpolate(frame, [change.at * fps, change.at * fps + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 12 })
  const leave = interpolate(frame, [frames - 6, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  return (
    <div
      style={{
        position: "absolute",
        top: 38,
        left: 0,
        right: 0,
        textAlign: "center",
        opacity: enter * leave,
        transform: `translateY(${(1 - enter) * 14}px)`,
      }}
    >
      {/* The kicker line is always laid out, so every headline sits on one baseline. */}
      <div style={{ height: 30, fontFamily: mono, fontSize: 20, letterSpacing: "0.06em", color: "rgba(255,244,234,0.78)", marginBottom: 6 }}>
        <span style={{ opacity: kickerIn }}>{kicker ?? ""}</span>
      </div>
      <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 64, letterSpacing: "-0.02em", color: INK, lineHeight: 1.05 }}>
        {/* `[x]` in a caption renders as a keycap, so the key reads as a key. */}
        {text.split(/(\[[^\]]+\])/).map((part, i) =>
          part.startsWith("[") ? (
            <span
              key={i}
              style={{
                display: "inline-block",
                fontFamily: mono,
                fontWeight: 700,
                fontSize: 52,
                background: KEY_BG,
                color: INK,
                borderRadius: 12,
                padding: "2px 22px 8px",
                margin: "0 2px 0 12px",
                boxShadow: "0 6px 0 #0D0B0A",
                transform: "translateY(-6px)",
              }}
            >
              {part.slice(1, -1)}
            </span>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </div>
    </div>
  )
}

export function Keycaps({ frames }: { frames: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const keys = ["r", "o", "v", "e", "⏎"]
  const leave = interpolate(frame, [frames - 5, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: leave }}>
      <div style={{ display: "flex", gap: 18, marginTop: 40 }}>
        {keys.map((key, i) => {
          const pop = spring({ frame: frame - i * 4, fps, config: { damping: 12, stiffness: 220 }, durationInFrames: 10 })
          const press = interpolate(frame - i * 4, [2, 4, 7], [0, 6, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
          const wide = key === "⏎"
          return (
            <div
              key={key}
              style={{
                width: wide ? 190 : 118,
                height: 118,
                borderRadius: 18,
                background: KEY_BG,
                color: INK,
                display: "flex",
                alignItems: "center",
                justifyContent: wide ? "flex-end" : "center",
                padding: wide ? "0 24px" : 0,
                fontFamily: sans,
                fontSize: wide ? 44 : 54,
                fontWeight: 500,
                boxShadow: `0 ${10 - press}px 0 #0D0B0A, 0 22px 40px rgba(30,8,8,0.35)`,
                transform: `translateY(${press}px) scale(${0.6 + 0.4 * pop})`,
                opacity: pop,
              }}
            >
              {key}
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

export function EndCard() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 14 })
  const second = spring({ frame: frame - 8, fps, config: { damping: 200 }, durationInFrames: 14 })
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
      <div style={{ opacity: enter, transform: `translateY(${(1 - enter) * 16}px)` }}>
        <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 132, color: INK, letterSpacing: "-0.02em" }}>
          [rove]
        </div>
        <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 52, color: INK, marginTop: 6, letterSpacing: "-0.015em" }}>
          Parallel coding agents in your terminal.
        </div>
      </div>
      <div
        style={{
          marginTop: 44,
          opacity: second,
          fontFamily: mono,
          fontSize: 30,
          color: INK,
          background: "rgba(30,20,18,0.55)",
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: 12,
          padding: "14px 26px",
        }}
      >
        <span style={{ color: ACCENT }}>$</span> curl -fsSL https://rove.run/install.sh | sh
      </div>
      {/* Where to go after the film — same first route as the site and README. */}
      <div style={{ marginTop: 22, opacity: second, fontFamily: sans, fontWeight: 600, fontSize: 40, color: INK, letterSpacing: "-0.01em" }}>
        rove.run
      </div>
    </AbsoluteFill>
  )
}
