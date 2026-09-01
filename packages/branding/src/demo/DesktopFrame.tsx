import { loadFont } from "@remotion/google-fonts/JetBrainsMono"
import { AbsoluteFill, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion"
import { monoStack, palettes } from "../colors"

loadFont("normal", { weights: ["400", "700"] })

/**
 * The screencast as a WINDOW on a desktop: the capture inset, rounded and
 * shadowed, over a wallpaper that carries the mark — with the narration on the
 * wallpaper rather than on the terminal.
 *
 * The alternative was making the terminal itself transparent so a page
 * backdrop shows through (it works — `.xterm-viewport` paints an opaque black
 * that has to be overridden). That route costs the WebGL renderer, whose
 * `customGlyphs` is the only thing that tiles block-drawing characters without
 * a seam, because the WebGL addon fills default-background cells as solid
 * colour and they read as black boxes once the background is transparent.
 * Compositing gives the same desktop reading with no such trade: the capture
 * stays exactly as recorded.
 *
 * It also fixes what the first narrated cut got wrong — captions sat ON the
 * terminal in near-terminal colours. Here they sit on wallpaper, where
 * contrast is something this file controls.
 */

const colors = palettes.dark

/**
 * Canvas and window geometry. The capture is 1280×800; the canvas adds an
 * EQUAL margin on all four sides, and the window is centred in it — so the
 * desktop reads as a uniform border rather than a window pinned near the top.
 * Derive both from one padding value so they cannot drift apart.
 */
const PADDING = 96
const SHOT = { width: 1280, height: 800 } as const
export const FRAME = {
  width: SHOT.width + PADDING * 2,
  height: SHOT.height + PADDING * 2,
} as const

type Beat = { readonly at: number; readonly caption: string }

/** Beats timed against the capture; seconds, not frames, so a re-shoot is one edit. */
export const BEATS: readonly Beat[] = [
  { at: 0, caption: "A finished turn — its own branch, its own commit" },
  { at: 5, caption: "A follow-up goes to that session; it keeps working" },
  { at: 8, caption: "Another task, another worktree and branch" },
  { at: 10, caption: "Scheduled prompts spawn their own tasks" },
  { at: 12, caption: "Back to the first agent — done while you were away" },
]

function Caption({ text }: { text: string }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const opacity = interpolate(frame, [0, fps * 0.3], [0, 1], { extrapolateRight: "clamp" })
  const lift = interpolate(frame, [0, fps * 0.4], [6, 0], { extrapolateRight: "clamp" })
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", pointerEvents: "none" }}>
      <div
        style={{
          opacity,
          transform: `translateY(${lift}px)`,
          marginBottom: 26,
          fontFamily: monoStack,
          fontSize: 23,
          letterSpacing: "0.01em",
          color: colors.fg,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ width: 20, height: 2, backgroundColor: colors.blue, display: "inline-block" }} />
        {text}
      </div>
    </AbsoluteFill>
  )
}

export function DesktopFrame({ captureSeconds }: { captureSeconds: number }) {
  const { fps } = useVideoConfig()

  return (
    <AbsoluteFill style={{ backgroundColor: "#1B1815" }}>
      {/* Wallpaper. The capture is recorded transparent over THIS same asset
          (HERO_CAPTURE_WALLPAPER), so the window shows real wallpaper through
          the terminal and the margin continues it — one desktop, not a sticker
          on a backdrop. */}
      <Img
        src={staticFile("demo/wallpaper.svg")}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />

      {/* The window, at native size and centred — `PADDING` on every side. */}
      <div
        style={{
          position: "absolute",
          left: PADDING,
          top: PADDING,
          width: SHOT.width,
          height: SHOT.height,
          borderRadius: 12,
          overflow: "hidden",
          border: `1px solid ${colors.border}`,
          boxShadow: "0 30px 70px rgba(0,0,0,0.55), 0 6px 18px rgba(0,0,0,0.4)",
        }}
      >
        <OffthreadVideo
          src={staticFile("demo/demo.mp4")}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      </div>

      {BEATS.map((beat, i) => {
        const next = BEATS[i + 1]?.at ?? captureSeconds
        return (
          <Sequence
            key={beat.at}
            from={Math.round(beat.at * fps)}
            durationInFrames={Math.max(1, Math.round((next - beat.at) * fps))}
          >
            <Caption text={beat.caption} />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
