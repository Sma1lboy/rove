// The real-terminal film: clips of an actual Rove session (`bun e2e/film.ts render handoff` in
// packages/rove-harness writes them to public/handoff), framed on the paper canvas with one plain
// sentence per beat. Nothing is drawn over the terminal; the camera only zooms.

import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion"
import clipIndex from "../../public/handoff/clips.json"
import { P } from "../promo/promo-theme"
import { Caret, eio, MONO, prog, rise, SANS, typed } from "../typed/kit"

export const REAL_FPS = 30
const WINDOW = { x: 160, y: 150, w: 1600, h: 900 }
const END = 110

type Zoom = { at: number; fx: number; fy: number; s: number }
type Scene = { clip: keyof typeof clipIndex; chapter: number; fast?: boolean; zoom?: readonly Zoom[] }

// `at` is seconds into the scene; the camera eases from one entry to the next.
const SCENES: readonly Scene[] = [
  { clip: "new", chapter: 0 },
  { clip: "work", chapter: 0, fast: true },
  { clip: "limit", chapter: 1, zoom: [{ at: 0.4, fx: 0.3, fy: 0, s: 1 }, { at: 1.6, fx: 0.3, fy: 0, s: 1.3 }] },
  { clip: "picker", chapter: 2, zoom: [{ at: 0, fx: 0.5, fy: 0.5, s: 1.2 }] },
  { clip: "codex", chapter: 2, fast: true },
  { clip: "delegate", chapter: 3, fast: true, zoom: [{ at: -2.6, fx: 0, fy: 0.12, s: 1 }, { at: -1.6, fx: 0, fy: 0.12, s: 1.5 }] },
  { clip: "close", chapter: 4 },
  { clip: "reopen", chapter: 5, zoom: [{ at: 0.6, fx: 0.4, fy: 0.3, s: 1 }, { at: 1.6, fx: 0.4, fy: 0.3, s: 1.25 }] },
  { clip: "report", chapter: 5, zoom: [{ at: 0.3, fx: 0.5, fy: 0.62, s: 1 }, { at: 1.4, fx: 0.5, fy: 0.62, s: 1.18 }] },
]

const COPY = {
  en: {
    chapters: [
      ["New task", "Type one sentence. Claude Code starts working on it."],
      ["Out of quota", "Halfway through, Claude Code hits its usage limit."],
      ["Switch agents", "Hand the task to Codex. It picks up where Claude stopped."],
      ["Agents talk directly", "Codex gives the README to another agent. Nobody relays."],
      ["Keeps running", "Close the terminal. Both agents keep working."],
      ["Inbox", "Come back and the Inbox shows who finished. It already sent its report."],
    ],
    fast: "sped up",
    real: "a real session, recorded in the terminal",
    tagline: "All your coding agents, in one place.",
  },
  zh: {
    chapters: [
      ["新建任务", "打一句话，Claude Code 就开始干。"],
      ["额度用完", "干到一半，Claude Code 的额度用完了。"],
      ["换一个 agent", "把任务换给 Codex，它从 Claude 停下的地方接着干。"],
      ["agent 之间直接对话", "Codex 把 README 交给另一个 agent，不用你传话。"],
      ["关了也在跑", "关掉终端，两个 agent 继续干活。"],
      ["收件箱", "回来时收件箱告诉你谁做完了，它已经把回报发回去了。"],
    ],
    fast: "已加速",
    real: "真实会话，在终端里录的",
    tagline: "所有编程 agent，都在一个地方。",
  },
} as const
export type RealLang = keyof typeof COPY

const frames = (scene: Scene) => Math.round(clipIndex[scene.clip].duration * REAL_FPS)
const STARTS = SCENES.reduce<number[]>((acc, scene, i) => [...acc, i === 0 ? 0 : (acc[i - 1] as number) + frames(SCENES[i - 1] as Scene)], [])
const BODY = (STARTS[STARTS.length - 1] as number) + frames(SCENES[SCENES.length - 1] as Scene)
export const REAL = { width: 1920, height: 1080, fps: REAL_FPS, durationInFrames: BODY + END }

function camera(scene: Scene, local: number): { fx: number; fy: number; s: number } {
  const keys = (scene.zoom ?? []).map((key) => ({ ...key, f: (key.at < 0 ? clipIndex[scene.clip].duration + key.at : key.at) * REAL_FPS }))
  const first = keys[0]
  if (!first) return { fx: 0.5, fy: 0.5, s: 1 }
  let from = first
  for (const key of keys) {
    if (key.f > local) {
      const t = eio(prog(local, from.f, Math.max(1, key.f - from.f)))
      return { fx: from.fx + (key.fx - from.fx) * t, fy: from.fy + (key.fy - from.fy) * t, s: from.s + (key.s - from.s) * t }
    }
    from = key
  }
  return from
}

export const RealFilm: React.FC<{ lang?: RealLang }> = ({ lang = "en" }) => {
  const frame = useCurrentFrame()
  const c = COPY[lang]
  const index = Math.max(0, STARTS.filter((start) => start <= frame).length - 1)
  const scene = SCENES[Math.min(index, SCENES.length - 1)] as Scene
  const local = frame - (STARTS[index] as number)
  const cam = camera(scene, local)
  const tEnd = frame - BODY
  const out = prog(tEnd, 0, 14)
  const chapterStart = STARTS[SCENES.findIndex((s) => s.chapter === scene.chapter)] as number
  const [title, sub] = c.chapters[scene.chapter] as readonly [string, string]

  return (
    <AbsoluteFill style={{ backgroundColor: P.canvas }}>
      {out < 1 && (
        <div style={{ opacity: 1 - out }}>
          <div
            style={{
              position: "absolute",
              left: WINDOW.x,
              top: WINDOW.y,
              width: WINDOW.w,
              height: WINDOW.h,
              borderRadius: 18,
              overflow: "hidden",
              background: "#141413",
              boxShadow: "0 30px 80px rgba(60,30,16,.18), 0 0 0 1px rgba(33,28,24,.12)",
            }}
          >
            <div style={{ width: "100%", height: "100%", transform: `scale(${cam.s})`, transformOrigin: `${cam.fx * 100}% ${cam.fy * 100}%` }}>
              {SCENES.map((s, i) => (
                <Sequence key={s.clip} from={STARTS[i]} durationInFrames={frames(s)} layout="none">
                  <OffthreadVideo src={staticFile(`handoff/${s.clip}.mp4`)} muted style={{ width: WINDOW.w, height: WINDOW.h, display: "block" }} />
                </Sequence>
              ))}
            </div>
          </div>
          <div style={{ position: "absolute", left: WINDOW.x, top: 44, opacity: rise(frame, chapterStart, 10), fontFamily: SANS, color: P.ink }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20, padding: "3px 11px", borderRadius: 999, background: P.accent, color: "#fff" }}>
                {String(scene.chapter + 1).padStart(2, "0")}
              </span>
              <span style={{ fontWeight: 600, fontSize: 38, letterSpacing: "-0.02em" }}>{title}</span>
            </div>
            <div style={{ fontSize: 25, color: P.ink2, marginTop: 6 }}>{sub}</div>
          </div>
          <div style={{ position: "absolute", right: 160, top: 64, fontFamily: MONO, fontSize: 20, color: P.ink2, textAlign: "right" }}>
            {c.real}
            {scene.fast ? <span style={{ marginLeft: 16, padding: "3px 10px", borderRadius: 8, border: `1.5px solid ${P.hair}`, color: P.accentText }}>{c.fast}</span> : null}
          </div>
        </div>
      )}
      {tEnd >= 8 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", color: P.ink }}>
          <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 170, letterSpacing: "0.02em", whiteSpace: "nowrap", opacity: rise(tEnd, 8, 10) }}>
            <span style={{ color: P.accent }}>[</span> {typed("rove", tEnd, 14, 30)}
            {tEnd < 40 ? <Caret frame={tEnd} solid /> : " "}
            <span style={{ color: P.accent }}>]</span>
          </div>
          <div style={{ fontFamily: SANS, fontSize: 46, marginTop: 22, opacity: rise(tEnd, 40, 12) }}>{c.tagline}</div>
          <div style={{ fontFamily: MONO, fontSize: 24, color: P.ink2, marginTop: 34, opacity: rise(tEnd, 52, 12) }}>
            curl -fsSL https://rove.run/install.sh | sh&nbsp;&nbsp;·&nbsp;&nbsp;MIT&nbsp;&nbsp;·&nbsp;&nbsp;github.com/Sma1lboy/rove
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  )
}
