import { loadFont as loadSans } from "@remotion/google-fonts/InstrumentSans"
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono"
import type { ReactNode } from "react"
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion"

const { fontFamily: sans } = loadSans("normal", { weights: ["500", "600", "700"] })
const { fontFamily: mono } = loadMono("normal", { weights: ["400", "700"] })

/**
 * The multi-repo landing cut: three repos, a task started in each, the
 * terminal closed and reopened with the agents still going, then a diff.
 *
 * Every frame of the window is the raw take from
 * `packages/kobe-harness/e2e/hero-multirepo.ts` — the real TUI and real Claude
 * Code turns. This file only chooses which seconds of it to show and how fast,
 * and puts the captions on the wallpaper around it (the launch film's look).
 * Source times below are seconds into `public/multirepo/take.mp4` and come
 * from that take's `beats.json`; a re-shoot means re-reading those numbers.
 */

export const FPS = 30
const SHOT = { width: 1440, height: 810 } as const
const SCALE = 1.03
const BAR = 34
const WIN = { width: SHOT.width * SCALE, height: SHOT.height * SCALE + BAR } as const
const WIN_LEFT = (1920 - WIN.width) / 2
const WIN_TOP = 176

const INK = "#FFF8F1"
const KEY_BG = "#1E1B19"
const ACCENT = "#F2A57E"

/** One stretch of the take: source [from, to] played back `rate`× faster. */
type Clip = { readonly from: number; readonly to: number; readonly rate: number }

const seconds = (clips: readonly Clip[]) => clips.reduce((sum, clip) => sum + (clip.to - clip.from) / clip.rate, 0)

/** Where the sidebar sits in the capture, for the camera and the highlight. */
const SIDEBAR = { x: 0, y: 104, width: 228, height: 272 } as const

type Scene = {
  readonly kind: "take" | "keys" | "end"
  readonly caption?: string
  readonly kicker?: string
  readonly clips?: readonly Clip[]
  readonly seconds?: number
  /** Push the camera in on the sidebar across this scene. */
  readonly zoomSidebar?: boolean
  /** Close the window over the last half second. */
  readonly closeOut?: boolean
  /** Open the window over the first half second. */
  readonly openIn?: boolean
  /**
   * Seconds into the scene at which `n` goes down: a keycap pops up beside
   * the sidebar's "New task  + n" row and that row lights up, just before the
   * dialog the keystroke opens. Without it the dialog simply appears.
   */
  readonly keyPress?: number
  /** Later kickers within the scene: from `at` seconds in, `text` replaces the kicker. */
  readonly kickerChanges?: readonly { readonly at: number; readonly text: string }[]
  /**
   * Paint `detached-patch.png` over the capture line where the harness prints
   * "[detached: engine exited — reattach below]" when its TUI tab closes. That
   * is the web harness talking about ITS pty, not Rove's engines, and on
   * screen it read as an error right before "Nothing stopped". The patch is
   * the same row's own background (and the pane border column through it).
   */
  readonly coverDetachedLine?: boolean
}

const SCENES: readonly Scene[] = [
  { kind: "keys", seconds: 1.3, caption: "" },
  {
    kind: "take",
    kicker: "repo 1 · orbit-sdk · Claude Code",
    caption: "Press [n]. Pick a repo. Hand it a task.",
    openIn: true,
    // `n` goes down at ~7.9s in the take; slowed so the keypress registers.
    keyPress: (7.9 - 6.2) / 1.6,
    clips: [
      { from: 6.2, to: 8.4, rate: 1.6 },
      { from: 8.4, to: 15.3, rate: 3.5 },
      { from: 15.3, to: 26.4, rate: 14 },
      { from: 26.4, to: 31.0, rate: 3 },
    ],
  },
  {
    kind: "take",
    kicker: "repo 2 · atlas-web · Codex",
    // The third `n` lands ~57.8s in the take: 0.75 + 1.37 + 2.45 + 0.07s in.
    kickerChanges: [{ at: 4.6, text: "repo 3 · ledger-api · Claude Code" }],
    caption: "Another repo. Another engine.",
    // Second `n` at ~31.35s in the take.
    keyPress: (31.35 - 30.6) / 1.6,
    clips: [
      { from: 30.6, to: 31.8, rate: 1.6 },
      // The dialog with codex picked, at a readable pace.
      { from: 31.8, to: 40.0, rate: 6 },
      // Jump cut over 40.0–51.6: Codex's "Hooks need review" prompt (the
      // operator's hooks.json, not the product) fills that whole stretch.
      // The Codex banner, the prompt going in, "Working".
      { from: 51.6, to: 57.0, rate: 2.2 },
      { from: 57.0, to: 78.5, rate: 12 },
    ],
  },
  {
    kind: "take",
    kicker: "3 repos · 2 engines · 3 agents",
    caption: "All running at once.",
    zoomSidebar: true,
    clips: [{ from: 78.5, to: 86.5, rate: 2.7 }],
  },
  {
    kind: "take",
    caption: "Close the terminal.",
    closeOut: true,
    coverDetachedLine: true,
    clips: [{ from: 86.5, to: 89.6, rate: 1.6 }],
  },
  { kind: "keys", seconds: 1.5, caption: "Come back whenever." },
  {
    kind: "take",
    kicker: "the daemon kept them going",
    caption: "Nothing stopped.",
    openIn: true,
    zoomSidebar: true,
    clips: [{ from: 96.5, to: 105.7, rate: 3 }],
  },
  {
    kind: "take",
    kicker: "orbit-sdk · its own branch",
    caption: "Open one. Read the diff.",
    clips: [
      { from: 105.7, to: 113.6, rate: 3.8 },
      { from: 113.6, to: 119.5, rate: 2.0 },
    ],
  },
  { kind: "end", seconds: 2.4 },
]

const sceneSeconds = (scene: Scene) => scene.seconds ?? seconds(scene.clips ?? [])
export const TOTAL_SECONDS = SCENES.reduce((sum, scene) => sum + sceneSeconds(scene), 0)

// ── pieces ──────────────────────────────────────────────────────────────

function Wallpaper() {
  const frame = useCurrentFrame()
  const drift = interpolate(frame, [0, TOTAL_SECONDS * FPS], [0, 1])
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

function Caption({
  text,
  kicker: firstKicker,
  kickerChanges = [],
  frames,
}: {
  text: string
  kicker?: string
  kickerChanges?: Scene["kickerChanges"]
  frames: number
}) {
  const now = useCurrentFrame()
  const fpsNow = useVideoConfig().fps
  // The kicker in force now, and a short fade in after each change.
  const change = [...kickerChanges].reverse().find((c) => now >= c.at * fpsNow)
  const kicker = change?.text ?? firstKicker
  const kickerIn = change
    ? interpolate(now, [change.at * fpsNow, change.at * fpsNow + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
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

function TakeWindow({ scene, frames }: { scene: Scene; frames: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const clips = scene.clips ?? []

  // Camera: a push-in on the sidebar, eased, held, then released at the end.
  const zoom = scene.zoomSidebar
    ? interpolate(frame, [0, fps * 0.8, frames - fps * 0.35, frames], [1, 1.32, 1.32, 1], {
        easing: Easing.inOut(Easing.cubic),
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1
  const focusY = BAR + (SIDEBAR.y + SIDEBAR.height / 2) * SCALE
  const openT = scene.openIn ? spring({ frame, fps, config: { damping: 18, stiffness: 140 }, durationInFrames: 16 }) : 1
  const closeT = scene.closeOut
    ? interpolate(frame, [frames - fps * 0.55, frames], [1, 0], { easing: Easing.in(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1
  const presence = Math.min(openT, closeT)
  const highlight = scene.zoomSidebar
    ? interpolate(frame, [fps * 0.6, fps * 1.0, frames - fps * 0.5, frames - fps * 0.3], [0, 1, 1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0

  let at = 0
  return (
    <div
      style={{
        position: "absolute",
        left: WIN_LEFT,
        top: WIN_TOP,
        width: WIN.width,
        height: WIN.height,
        opacity: presence,
        transform: `translateY(${(1 - presence) * 40}px) scale(${0.94 + 0.06 * presence})`,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 14,
          overflow: "hidden",
          background: "#141413",
          boxShadow: "0 40px 90px rgba(40,10,10,0.45), 0 8px 24px rgba(40,10,10,0.35)",
          border: "1px solid rgba(255,255,255,0.10)",
        }}
      >
        <div
          style={{
            height: BAR,
            display: "flex",
            alignItems: "center",
            padding: "0 14px",
            background: "#1F1D1B",
            borderBottom: "1px solid #2E2B28",
            position: "relative",
          }}
        >
          {["#FF5F57", "#FEBC2E", "#28C840"].map((color) => (
            <span key={color} style={{ width: 12, height: 12, borderRadius: 6, background: color, marginRight: 8 }} />
          ))}
          <span
            style={{ position: "absolute", left: 0, right: 0, textAlign: "center", fontFamily: mono, fontSize: 14, color: "#A9A39A" }}
          >
            rove
          </span>
        </div>
        <div style={{ position: "relative", width: "100%", height: WIN.height - BAR, overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              transformOrigin: `0px ${focusY - BAR}px`,
              transform: `scale(${zoom})`,
            }}
          >
            {clips.map((clip) => {
              const length = Math.round(((clip.to - clip.from) / clip.rate) * fps)
              const from = at
              at += length
              return (
                <Sequence key={clip.from} from={from} durationInFrames={length} layout="none">
                  <OffthreadVideo
                    src={staticFile("multirepo/take.mp4")}
                    startFrom={Math.round(clip.from * fps)}
                    playbackRate={clip.rate}
                    muted
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                  />
                </Sequence>
              )
            })}
            <div
              style={{
                position: "absolute",
                left: SIDEBAR.x * SCALE + 2,
                top: SIDEBAR.y * SCALE,
                width: SIDEBAR.width * SCALE,
                height: SIDEBAR.height * SCALE,
                borderRadius: 8,
                border: `2px solid ${ACCENT}`,
                boxShadow: `0 0 0 6px rgba(242,165,126,0.18)`,
                opacity: highlight,
              }}
            />
            {scene.keyPress !== undefined ? <KeyPress at={scene.keyPress} /> : null}
            {scene.coverDetachedLine ? (
              <Img
                src={staticFile("multirepo/detached-patch.png")}
                style={{ position: "absolute", left: 0, top: 271 * SCALE, width: 300 * SCALE, height: 18 * SCALE }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/** The sidebar's "New task  + n" row, in capture pixels. */
const NEW_TASK_ROW = { x: 0, y: 32, width: 228, height: 16 } as const

function KeyPress({ at }: { at: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const down = at * fps
  const t = frame - down
  const ring = interpolate(t, [-fps * 0.3, 0, fps * 0.9, fps * 1.2], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const pulse = interpolate(t, [0, fps * 0.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
  return (
    <div
        style={{
          position: "absolute",
          left: NEW_TASK_ROW.x * SCALE + 2,
          top: (NEW_TASK_ROW.y - 3) * SCALE,
          width: NEW_TASK_ROW.width * SCALE,
          height: (NEW_TASK_ROW.height + 6) * SCALE,
          borderRadius: 6,
          border: `2px solid ${ACCENT}`,
          background: "rgba(242,165,126,0.14)",
          boxShadow: `0 0 0 ${4 + pulse * 10}px rgba(242,165,126,${0.28 * (1 - pulse)})`,
          opacity: ring,
        }}
      />
  )
}

function Keycaps({ frames }: { frames: number }) {
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

function EndCard({ frames }: { frames: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 14 })
  const second = spring({ frame: frame - 8, fps, config: { damping: 200 }, durationInFrames: 14 })
  void frames
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

function SceneView({ scene, frames }: { scene: Scene; frames: number }): ReactNode {
  if (scene.kind === "keys") {
    return (
      <>
        <Keycaps frames={frames} />
        {scene.caption ? <Caption text={scene.caption} frames={frames} /> : null}
      </>
    )
  }
  if (scene.kind === "end") return <EndCard frames={frames} />
  return (
    <>
      <TakeWindow scene={scene} frames={frames} />
      {scene.caption ? <Caption text={scene.caption} kicker={scene.kicker} kickerChanges={scene.kickerChanges} frames={frames} /> : null}
    </>
  )
}

export function MultiRepoCut() {
  const { fps } = useVideoConfig()
  let at = 0
  return (
    <AbsoluteFill>
      <Wallpaper />
      {SCENES.map((scene, i) => {
        const frames = Math.round(sceneSeconds(scene) * fps)
        const from = at
        at += frames
        return (
          <Sequence key={i} from={from} durationInFrames={frames}>
            <SceneView scene={scene} frames={frames} />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}
