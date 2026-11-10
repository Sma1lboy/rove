// Shared pieces of the typed film: easing and typing helpers, and the screen-space
// chrome (chapter card, chapter label, key hints) that sits over the stage.

import { AbsoluteFill, Easing } from "remotion"
import { P } from "../promo/promo-theme"
import { CARD, cardStart, WIPE } from "./timeline"

export const SANS = '"Instrument Sans", "PingFang SC", system-ui, sans-serif'
export const MONO = '"JetBrains Mono", "PingFang SC", ui-monospace, monospace'
export const AMBER = "#A87B1E"

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
export const prog = (f: number, start: number, dur: number) => clamp01((f - start) / dur)
export const eio = Easing.inOut(Easing.cubic)
export const eout = Easing.out(Easing.cubic)
/** 0 → 1 from `start`, eased out. */
export const rise = (f: number, start: number, dur = 14) => eout(prog(f, start, dur))

/** The part of `s` typed by frame f, when typing runs from `start` to `end`. */
export const typed = (s: string, f: number, start: number, end: number) => {
  const chars = Array.from(s)
  return chars.slice(0, Math.round(prog(f, start, end - start) * chars.length)).join("")
}

export const Caret: React.FC<{ frame: number; solid?: boolean }> = ({ frame, solid }) => (
  <span
    style={{
      display: "inline-block",
      width: "0.07em",
      height: "1.08em",
      marginLeft: "0.08em",
      verticalAlign: "-0.2em",
      background: P.accent,
      opacity: solid || frame % 60 < 36 ? 1 : 0.15,
    }}
  />
)

export type GlyphKind = "run" | "done" | "ask" | "routine"

/** A task's status mark. A running one breathes; the rest sit still. */
export const Glyph: React.FC<{ kind: GlyphKind; frame: number; phase?: number }> = ({ kind, frame, phase = 0 }) => {
  if (kind === "done") return <span style={{ color: P.greenText }}>✓</span>
  if (kind === "ask") return <span style={{ color: AMBER }}>?</span>
  if (kind === "routine") return <span style={{ color: P.ink2 }}>↻</span>
  return <span style={{ color: P.accent, opacity: 0.78 + 0.22 * Math.sin((frame + phase) / 7) }}>●</span>
}

/** The picked option, the way a candidate bar marks its first candidate. */
export const Sel: React.FC<{ on: boolean; children: React.ReactNode }> = ({ on, children }) => (
  <span
    style={{
      padding: "5px 14px",
      borderRadius: 9,
      background: on ? P.accent : "transparent",
      color: on ? "#fff" : P.ink,
      fontWeight: on ? 700 : 400,
    }}
  >
    {children}
  </span>
)

/** A card that drops in under the line being typed. `show` runs 0 → 1. */
export const Popup: React.FC<{ x: number; y: number; show: number; children: React.ReactNode; width?: number }> = ({
  x,
  y,
  show,
  children,
  width,
}) =>
  show <= 0 ? null : (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        opacity: show,
        transform: `translateY(${(1 - show) * -12}px) scale(${0.94 + 0.06 * show})`,
        transformOrigin: "0 0",
        padding: "16px 20px",
        borderRadius: 16,
        background: P.island,
        border: `1px solid ${P.hair}`,
        boxShadow: "0 18px 44px rgba(60,36,20,.13), 0 2px 6px rgba(60,36,20,.06)",
        fontFamily: MONO,
        fontSize: 26,
        color: P.ink,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </div>
  )

/** The full-screen colour card that opens a chapter: in from the right, out through the top. */
export const ChapterCard: React.FC<{ frame: number; i: number; total: number; title: string; sub: string }> = ({
  frame,
  i,
  total,
  title,
  sub,
}) => {
  const t = frame - cardStart(i)
  if (t < 0 || t >= CARD) return null
  const enter = eout(prog(t, 0, WIPE))
  const exit = eio(prog(t, CARD - WIPE, WIPE))
  const text = rise(t, 5, 12) * (1 - prog(t, CARD - WIPE, WIPE * 0.7))
  return (
    <AbsoluteFill
      style={{
        transform: `translate(${(1 - enter) * 100}%, ${-exit * 100}%)`,
        background: `linear-gradient(135deg, #D07A55 0%, ${P.accent} 55%, #B25E3D 100%)`,
        boxShadow: `0 0 90px 50px ${P.accent}`,
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
      }}
    >
      <div style={{ opacity: text, transform: `translateY(${(1 - text) * 18}px)`, textAlign: "center" }}>
        <div style={{ fontFamily: MONO, fontSize: 26, opacity: 0.8, letterSpacing: "0.08em" }}>
          {String(i + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
        </div>
        <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 132, letterSpacing: "-0.03em", lineHeight: 1.2 }}>
          {title}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 38, opacity: 0.92, marginTop: 6 }}>{sub}</div>
      </div>
    </AbsoluteFill>
  )
}

/** The chapter's name, parked top-left while its demo plays. */
export const ChapterLabel: React.FC<{ show: number; i: number; title: string; sub: string }> = ({ show, i, title, sub }) => (
  <div
    style={{
      position: "absolute",
      left: 40,
      top: 30,
      padding: "18px 28px 20px 24px",
      borderRadius: 20,
      // Rows pan underneath in the close shots; the plate keeps the label readable.
      background: P.canvas,
      boxShadow: `0 0 24px 14px ${P.canvas}`,
      opacity: show,
      fontFamily: SANS,
      color: P.ink,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <span
        style={{
          fontFamily: MONO,
          fontWeight: 700,
          fontSize: 20,
          padding: "3px 11px",
          borderRadius: 999,
          background: P.accent,
          color: "#fff",
        }}
      >
        {String(i + 1).padStart(2, "0")}
      </span>
      <span style={{ fontWeight: 600, fontSize: 40, letterSpacing: "-0.02em" }}>{title}</span>
    </div>
    <div style={{ fontSize: 24, color: P.ink2, marginTop: 6 }}>{sub}</div>
  </div>
)

export type KeyEvent = { f: number; keys: string[] }

const KEY_HOLD = 50

/** The key just pressed, bottom centre: it lights for a beat, then fades. */
export const KeyHints: React.FC<{ frame: number; events: KeyEvent[] }> = ({ frame, events }) => {
  const ev = events.filter((e) => frame >= e.f && frame < e.f + KEY_HOLD).pop()
  if (!ev) return null
  const t = frame - ev.f
  const opacity = rise(t, 0, 6) * (1 - prog(t, KEY_HOLD - 12, 12))
  const down = t >= 4 && t < 24
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 968,
        display: "flex",
        justifyContent: "center",
        gap: 12,
        opacity,
      }}
    >
      {ev.keys.map((k, i) => (
        <span
          key={i}
          style={{
            fontFamily: MONO,
            fontSize: 24,
            fontWeight: 700,
            padding: "9px 18px",
            borderRadius: 11,
            background: P.island,
            border: `2px solid ${down ? P.accent : P.hair}`,
            color: down ? P.accentText : P.ink2,
            boxShadow: down ? "0 1px 0 rgba(60,36,20,.10)" : "0 4px 0 rgba(60,36,20,.10)",
            transform: `translateY(${down ? 3 : 0}px)`,
          }}
        >
          {k}
        </span>
      ))}
    </div>
  )
}
