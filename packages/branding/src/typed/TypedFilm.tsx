// The typed film: Rove sells itself by being used. Eight prompts get typed, each leaves
// a row in one task list, and the pull-back at the end shows the list as the summary.
// Copy lives in copy.ts (one entry per language), beats in timeline.ts.

import { AbsoluteFill, useCurrentFrame } from "remotion"
import { P, Wordmark } from "../promo/promo-theme"
import { COPY, type Lang } from "./copy"
import { Caret, ChapterCard, ChapterLabel, eio, KeyHints, type KeyEvent, MONO, prog, rise, SANS, typed } from "./kit"
import { PhoneList, SLOT_Y, Stage } from "./stage"
import { at, CARD, cardStart, CHAPTERS, chapterAt, cutAt, FINALE_START, WIPE } from "./timeline"

type Cam = { tx: number; ty: number; s: number }

/** Park world row `y` on the line the eye rests on. */
const focus = (y: number, s = 1.5): Cam => ({ tx: 200, ty: 500 - (y + 36) * s, s })

const SHOTS: { f: number; d: number; cam: Cam }[] = [
  { f: cutAt(0), d: 1, cam: focus(SLOT_Y[0]) },
  { f: cutAt(1), d: 1, cam: focus(SLOT_Y[1]) },
  { f: cutAt(2), d: 1, cam: focus(SLOT_Y[2]) },
  { f: at(2, 84), d: 44, cam: focus(SLOT_Y[2] + 150, 1.2) },
  { f: cutAt(3), d: 1, cam: { tx: 463, ty: 243, s: 0.93 } },
  { f: cutAt(4), d: 1, cam: focus(SLOT_Y[1]) },
  { f: cutAt(5), d: 1, cam: focus(SLOT_Y[0], 1.35) },
  { f: cutAt(6), d: 1, cam: focus(SLOT_Y[3]) },
  { f: cutAt(7), d: 1, cam: { tx: 332, ty: 300, s: 0.8 } },
  { f: FINALE_START, d: 50, cam: { tx: 470, ty: 200, s: 0.95 } },
]

function cameraAt(frame: number): Cam {
  const i = SHOTS.filter((k) => frame >= k.f).length - 1
  if (i <= 0) return SHOTS[0].cam
  const { f, d, cam: b } = SHOTS[i]
  const a = SHOTS[i - 1].cam
  const p = eio(prog(frame, f, d))
  return { tx: a.tx + (b.tx - a.tx) * p, ty: a.ty + (b.ty - a.ty) * p, s: a.s + (b.s - a.s) * p }
}

const KEYS: KeyEvent[] = [
  { f: 52, keys: ["enter"] },
  { f: at(0, 6), keys: ["ctrl+a", "n"] },
  { f: at(0, 106), keys: ["enter"] },
  { f: at(1, 0), keys: ["ctrl+e"] },
  { f: at(1, 62), keys: ["→"] },
  { f: at(1, 94), keys: ["enter"] },
  { f: at(2, 0), keys: ["ctrl+a", "n"] },
  { f: at(2, 70), keys: ["enter"] },
  { f: at(3, 26), keys: ["ctrl+q", "ctrl+q"] },
  { f: at(3, 130), keys: ["enter"] },
  { f: at(4, 24), keys: ["ctrl+a", "i"] },
  { f: at(4, 126), keys: ["enter"] },
  { f: at(5, 14), keys: ["ctrl+a", "p"] },
  { f: at(6, 0), keys: ["ctrl+a", "2"] },
  { f: at(6, 80), keys: ["9"] },
  { f: at(6, 108), keys: ["enter"] },
  { f: at(7, 4), keys: ["rove --web"] },
]

const DotGrid: React.FC = () => (
  <AbsoluteFill
    style={{
      background: P.canvas,
      backgroundImage: "radial-gradient(rgba(33,28,24,.075) 1.6px, transparent 1.8px)",
      backgroundSize: "48px 48px",
    }}
  />
)

/** The opening: launch rove, then the claim, typed. */
const Intro: React.FC<{ frame: number; lang: Lang }> = ({ frame, lang }) => {
  const c = COPY[lang]
  const launched = frame >= 62
  return (
    <AbsoluteFill style={{ color: P.ink }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 96, display: "flex", justifyContent: "center", alignItems: "center", gap: 26 }}>
        <Wordmark size={44} ink={P.ink} bracket={P.accent} />
        <span style={{ width: 1, height: 30, background: P.hair }} />
        <span style={{ fontFamily: SANS, fontSize: 26, color: P.ink2 }}>{c.header}</span>
      </div>
      <div style={{ position: "absolute", left: 200, top: 372 }}>
        {launched ? (
          <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 96, letterSpacing: "-0.03em", whiteSpace: "nowrap" }}>
            {typed(c.hero, frame, 70, 150)}
            {frame < 156 && <Caret frame={frame} solid />}
          </div>
        ) : (
          <div style={{ fontFamily: MONO, fontSize: 88 }}>
            <span style={{ color: P.ink2 }}>$ </span>
            {typed("rove", frame, 20, 42)}
            <Caret frame={frame} solid={frame >= 20 && frame < 42} />
          </div>
        )}
        <div style={{ fontFamily: SANS, fontSize: 36, color: P.ink2, marginTop: 30, height: 50, whiteSpace: "nowrap" }}>
          {typed(c.heroSub, frame, 158, 214)}
          {frame >= 156 && frame < 222 && <Caret frame={frame} solid />}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 44 }}>
          {c.chapters.map(([name], i) => {
            const show = rise(frame, 222 + i * 6, 12)
            return (
              <span
                key={name}
                style={{
                  fontFamily: SANS,
                  fontSize: 24,
                  padding: "8px 18px",
                  borderRadius: 99,
                  background: P.island,
                  border: `1px solid ${P.hair}`,
                  opacity: show,
                  transform: `translateY(${(1 - show) * 14}px)`,
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ color: P.accent, marginRight: 9 }}>•</span>
                {name}
              </span>
            )
          })}
        </div>
      </div>
    </AbsoluteFill>
  )
}

/** The end card: a dot becomes the wordmark, then the line and where to get it. */
const EndCard: React.FC<{ t: number; tagline: string }> = ({ t, tagline }) => {
  const mark = rise(t, 104, 14)
  const line = rise(t, 150, 16)
  const foot = rise(t, 172, 16)
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", color: P.ink }}>
      <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 170, letterSpacing: "0.02em", whiteSpace: "nowrap", opacity: mark }}>
        <span style={{ color: P.accent }}>[</span>
        {" "}
        {typed("rove", t, 114, 138)}
        {t < 150 ? <Caret frame={t} solid /> : " "}
        <span style={{ color: P.accent }}>]</span>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 46, marginTop: 22, opacity: line, transform: `translateY(${(1 - line) * 12}px)` }}>{tagline}</div>
      <div style={{ fontFamily: MONO, fontSize: 24, color: P.ink2, marginTop: 34, opacity: foot }}>
        npm install -g @sma1lboy/rove&nbsp;&nbsp;·&nbsp;&nbsp;MIT&nbsp;&nbsp;·&nbsp;&nbsp;github.com/Sma1lboy/rove
      </div>
    </AbsoluteFill>
  )
}

export const TypedFilm: React.FC<{ lang?: Lang }> = ({ lang = "en" }) => {
  const frame = useCurrentFrame()
  const c = COPY[lang]
  const ch = chapterAt(frame)
  const tEnd = frame - FINALE_START

  const cam = cameraAt(frame)
  const prev = cameraAt(frame - 1)
  // A cheap stand-in for motion blur: soften the stage in proportion to camera speed.
  const blur = Math.min(7, (Math.abs(cam.tx - prev.tx) + Math.abs(cam.ty - prev.ty)) * 0.12)
  const stageOut = prog(tEnd, 96, 20)
  const phone = ch === 7 ? rise(frame, at(7, 34), 24) * (1 - prog(tEnd, 0, 24)) : 0

  return (
    <AbsoluteFill>
      <DotGrid />
      {ch < 0 && <Intro frame={frame} lang={lang} />}
      {ch >= 0 && stageOut < 1 && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transformOrigin: "0 0",
            transform: `translate(${cam.tx}px, ${cam.ty - stageOut * 40}px) scale(${cam.s})`,
            opacity: 1 - stageOut,
            filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
          }}
        >
          <Stage frame={frame} ch={ch} c={c} />
        </div>
      )}
      {phone > 0 && (
        <div
          style={{
            position: "absolute",
            left: 1370,
            top: 195,
            width: 330,
            height: 690,
            borderRadius: 48,
            border: `4px solid ${P.ink}`,
            background: P.island,
            boxShadow: "0 30px 80px rgba(60,36,20,.18)",
            padding: "58px 26px 0",
            opacity: Math.min(1, phone * 1.5),
            transform: `translateX(${(1 - phone) * 420}px)`,
          }}
        >
          <div style={{ position: "absolute", left: 115, top: 18, width: 100, height: 22, borderRadius: 99, background: P.ink }} />
          <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 22, color: P.ink, marginBottom: 8 }}>
            <span style={{ color: P.accent }}>[</span> rove <span style={{ color: P.accent }}>]</span>
          </div>
          <PhoneList frame={frame} c={c} />
        </div>
      )}
      {ch >= 0 && tEnd < 24 && (
        <ChapterLabel
          i={ch}
          title={c.chapters[ch][0]}
          sub={c.chapters[ch][1]}
          show={prog(frame, cardStart(ch) + CARD - WIPE, 12) * (1 - prog(tEnd, 0, 24))}
        />
      )}
      <KeyHints frame={frame} events={KEYS} />
      {tEnd >= 100 && <EndCard t={tEnd} tagline={c.tagline} />}
      {Array.from({ length: CHAPTERS }, (_, i) => (
        <ChapterCard key={i} frame={frame} i={i} total={CHAPTERS} title={c.chapters[i][0]} sub={c.chapters[i][1]} />
      ))}
    </AbsoluteFill>
  )
}
