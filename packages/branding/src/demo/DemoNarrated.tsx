import { loadFont } from "@remotion/google-fonts/JetBrainsMono"
import { AbsoluteFill, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion"
import { monoStack, palettes } from "../colors"

/**
 * Dark palette, pinned — not the module's themed `colors` export.
 *
 * That default follows `KOBE_BRAND_THEME` and lands on the light porcelain
 * palette, which is right for logos on a marketing page and wrong here: the
 * picture underneath is a dark terminal, so light cards flash white between
 * beats and a light caption block reads as a sticker pasted over the product.
 * The narration has to belong to the footage it annotates.
 */
const colors = palettes.dark

loadFont("normal", { weights: ["400", "700"] })

/**
 * The README screencast with narration: the raw capture as the picture, title
 * cards between beats, and a caption naming what is on screen.
 *
 * The capture alone shows a competent operator using a tool it assumes you
 * already understand — every pane switch is meaningful and none of it is
 * labelled. This adds the labels without touching a pixel of the product:
 * cards sit BETWEEN beats rather than over them, because a terminal frame is
 * dense and anything floating on top covers something that matters.
 */

type Beat = {
  /** Seconds into the CAPTURE where this beat starts. */
  readonly at: number
  /** Full-screen card shown before the beat plays; omit for no card. */
  readonly card?: { readonly kicker: string; readonly line: string }
  /** Caption held for the whole beat. */
  readonly caption: string
}

/**
 * Beats, timed against the capture. Data rather than markup so a re-shoot only
 * needs its seconds updated — the capture is a live engine session and its
 * pacing moves between takes.
 */
export const BEATS: readonly Beat[] = [
  {
    at: 0,
    card: { kicker: "ONE TERMINAL", line: "Several agents, each in its own worktree." },
    caption: "A finished turn — its own branch, its own commit",
  },
  { at: 5, caption: "A follow-up goes to that session; it keeps working" },
  {
    at: 8,
    card: { kicker: "MEANWHILE", line: "The second task never stopped." },
    caption: "Another task, another worktree and branch",
  },
  { at: 10, caption: "Scheduled prompts spawn their own tasks" },
  { at: 12, caption: "Back to the first agent — done while you were away" },
]

const CARD_SECONDS = 1.1

/**
 * Lay the timeline out once: where each beat's footage starts, and where the
 * card that introduces it starts.
 *
 * A card does not overlay its beat, it PRECEDES it, so every frame of card
 * pushes the remaining footage later. Computing the card starts and the beat
 * starts in two separate passes got this wrong by exactly one card length —
 * the "MEANWHILE" card landed on the previous beat, captioning the wrong pane.
 * One pass, one accumulator, no chance of the two disagreeing.
 */
function layout(fps: number, captureSeconds: number) {
  const cardFrames = Math.round(CARD_SECONDS * fps)
  const beats: { readonly from: number; readonly durationInFrames: number; readonly caption: string }[] = []
  const cards: { readonly from: number; readonly kicker: string; readonly line: string }[] = []
  let shift = 0
  for (const [i, beat] of BEATS.entries()) {
    if (beat.card) {
      // The card occupies the slot the beat is about to start in; the beat
      // (and everything after it) moves down by the card's length.
      cards.push({ from: Math.round(beat.at * fps) + shift, ...beat.card })
      shift += cardFrames
    }
    const nextAt = BEATS[i + 1]?.at ?? captureSeconds
    beats.push({
      from: Math.round(beat.at * fps) + shift,
      durationInFrames: Math.max(1, Math.round((nextAt - beat.at) * fps)),
      caption: beat.caption,
    })
  }
  return { beats, cards, total: shift, cardFrames }
}

export function demoDurationInFrames(captureSeconds: number, fps: number): number {
  return Math.round(captureSeconds * fps) + layout(fps, captureSeconds).total
}

/** Full-bleed card: kicker over one line, on brand paper. */
function TitleCard({ kicker, line }: { kicker: string; line: string }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const hold = CARD_SECONDS * fps
  const opacity = interpolate(frame, [0, fps * 0.18, hold - fps * 0.22, hold], [0, 1, 1, 0], {
    extrapolateRight: "clamp",
  })
  const lift = interpolate(frame, [0, fps * 0.3], [10, 0], { extrapolateRight: "clamp" })
  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.bg,
        alignItems: "center",
        justifyContent: "center",
        opacity,
        fontFamily: monoStack,
      }}
    >
      <div style={{ transform: `translateY(${lift}px)`, textAlign: "center", padding: "0 80px" }}>
        <div style={{ color: colors.blue, fontSize: 20, letterSpacing: "0.22em", fontWeight: 700, marginBottom: 26 }}>
          {kicker}
        </div>
        <div style={{ color: colors.fg, fontSize: 44, lineHeight: 1.35 }}>{line}</div>
      </div>
    </AbsoluteFill>
  )
}

/** Caption block, left-aligned and clear of the TUI's own status bar. */
function Caption({ text }: { text: string }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const opacity = interpolate(frame, [0, fps * 0.25], [0, 1], { extrapolateRight: "clamp" })
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", pointerEvents: "none" }}>
      <div
        style={{
          opacity,
          margin: "0 0 46px 60px",
          padding: "13px 20px",
          alignSelf: "flex-start",
          maxWidth: "74%",
          backgroundColor: `${colors.bg}F2`,
          borderLeft: `3px solid ${colors.blue}`,
          fontFamily: monoStack,
          fontSize: 21,
          color: colors.fg,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  )
}

export function DemoNarrated({ captureSeconds }: { captureSeconds: number }) {
  const { fps } = useVideoConfig()
  const { beats, cards, cardFrames } = layout(fps, captureSeconds)

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      {/* One continuous video. A fresh OffthreadVideo per beat would re-seek at
          every cut and flash a frame of the wrong beat at each boundary. */}
      <OffthreadVideo src={staticFile("demo/demo.mp4")} />

      {beats.map((beat) => (
        <Sequence key={beat.from} from={beat.from} durationInFrames={beat.durationInFrames}>
          <Caption text={beat.caption} />
        </Sequence>
      ))}

      {cards.map((card) => (
        <Sequence key={card.from} from={card.from} durationInFrames={cardFrames}>
          <TitleCard kicker={card.kicker} line={card.line} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
