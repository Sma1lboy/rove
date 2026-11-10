// The stage: one task list that grows a row per prompt. Everything here is laid out in
// world space and is a pure function of the frame; TypedFilm.tsx moves a camera over it.

import { P } from "../promo/promo-theme"
import type { Strings } from "./copy"
import { AMBER, Caret, Glyph, type GlyphKind, MONO, Popup, prog, rise, SANS, Sel, typed } from "./kit"
import { at, cutAt, FINALE_START } from "./timeline"

/** World y of each top-level row, and of the three agents the third one dispatches. */
export const SLOT_Y = [0, 120, 240, 620]
const KID_Y = [352, 436, 520]
const TEXT_X = 84
const FS = 52

/** The terminal window drawn around the list in the wide shots. */
export const WINDOW = { x: -90, y: -100, w: 1250, h: 850 }

// The beats, as absolute frames.
const C0 = at(0, 114)
const C1 = at(1, 100)
const C2 = at(2, 78)
/** The dispatching agent types one command per worker; each lands when its command ends. */
const CMD = [at(2, 100), at(2, 132), at(2, 164)]
const CMD_LEN = 24
const KIDS = CMD.map((f) => f + CMD_LEN + 2)
const REPORT = at(2, 206)
const C3 = at(6, 116)
const CLOSE = at(3, 44)
const REOPEN = at(3, 138)
const DONE0 = at(3, 78)
const KID_DONE = at(3, 98)
const ASK = at(4, 10)
const ANSWERED = at(4, 134)
const PR = at(5, 40)
const CHECKS = at(5, 80)

const BRANCH = ["rove/fix-login-redirect", "rove/review-that-fix"]
const ENGINES = ["claude", "codex", "copilot", "kimi", "pi", "omp"]
const WORKERS = ["codex", "copilot", "gemini"]

const Tag: React.FC<{ children: React.ReactNode; show?: number; accent?: boolean }> = ({ children, show = 1, accent }) => (
  <span
    style={{
      display: "inline-block",
      marginLeft: 24,
      padding: "3px 12px",
      borderRadius: 9,
      border: `1.5px solid ${accent ? P.accent : P.hair}`,
      background: P.island,
      color: accent ? P.accentText : P.ink2,
      fontSize: 26,
      verticalAlign: "0.22em",
      opacity: show,
      transform: `translateX(${(1 - show) * -14}px)`,
    }}
  >
    {children}
  </span>
)

type RowProps = {
  y: number
  frame: number
  /** Frame the row lands. */
  born: number
  glyph: GlyphKind
  title: string
  sub?: React.ReactNode
  engine?: string
  after?: React.ReactNode
  /** 0..1: how far the text has faded. The status mark never fades. */
  fade: number
  kid?: boolean
}

const Row: React.FC<RowProps> = ({ y, frame, born, glyph, title, sub, engine, after, fade, kid }) => {
  if (frame < born) return null
  const text = 1 - fade
  const size = kid ? 34 : FS
  return (
    <div style={{ position: "absolute", left: kid ? TEXT_X : 0, top: y, fontFamily: MONO, fontSize: size, whiteSpace: "nowrap" }}>
      <span
        style={{
          display: "inline-block",
          width: kid ? 56 : TEXT_X,
          transform: `scale(${0.4 + 0.6 * rise(frame, born, 12)})`,
          transformOrigin: "30% 60%",
        }}
      >
        <Glyph kind={glyph} frame={frame} phase={y} />
      </span>
      <span style={{ color: kid ? P.ink2 : P.ink, opacity: text }}>{title}</span>
      {engine && (
        <span style={{ opacity: text }}>
          <Tag show={rise(frame, born + 4, 14)}>{engine}</Tag>
        </span>
      )}
      <span style={{ opacity: text }}>{after}</span>
      {sub && (
        <div
          style={{
            position: "absolute",
            left: TEXT_X,
            top: 70,
            fontSize: 24,
            color: P.ink2,
            opacity: text * rise(frame, born + 8, 14),
          }}
        >
          {sub}
        </div>
      )}
    </div>
  )
}

/** The line being typed, in the slot its row will land in. */
const Live: React.FC<{ y: number; frame: number; text: string; typing: boolean }> = ({ y, frame, text, typing }) => (
  <div style={{ position: "absolute", left: 0, top: y, fontFamily: MONO, fontSize: FS, color: P.ink, whiteSpace: "nowrap" }}>
    <span style={{ display: "inline-block", width: TEXT_X, color: P.accent }}>❯</span>
    <span style={{ borderBottom: `3px solid ${P.hair}` }}>{text}</span>
    <Caret frame={frame} solid={typing} />
  </div>
)

const label: React.CSSProperties = { color: P.ink2, marginRight: 14 }

export const Stage: React.FC<{ frame: number; ch: number; c: Strings }> = ({ frame, ch, c }) => {
  const closed = rise(frame, CLOSE, 16) - rise(frame, REOPEN, 16)
  // In a close shot, rows from earlier chapters step back, the way finished text greys out.
  const closeShot = ch !== 3 && ch !== 7 && frame < FINALE_START
  const focus = ch === 4 ? 1 : ch === 5 ? 0 : -1
  const fade = (row: number, born: number) =>
    Math.max(closed * 0.86, closeShot && row !== focus && born < cutAt(ch) ? 0.58 : 0)

  const asking = frame >= ASK && frame < ANSWERED
  const windowShow = ch === 3 || ch === 7 ? 1 - prog(frame, FINALE_START, 24) : 0

  const live: [slot: number, text: string, from: number, to: number, until: number] | null =
    ch === 0 ? [0, c.fix, at(0, 40), at(0, 100), C0]
    : ch === 1 ? [1, c.review, at(1, 10), at(1, 55), C1]
    : ch === 2 ? [2, c.big, at(2, 16), at(2, 66), C2]
    : ch === 6 ? [3, c.routine, at(6, 24), at(6, 70), C3]
    : null

  const engineSel = frame >= at(1, 66) ? 1 : 0
  const cmd = CMD.filter((f) => frame >= f).length - 1
  const hourSet = frame >= at(6, 84)
  const out = (commit: number) => 1 - rise(frame, commit - 6, 8)

  return (
    <>
      {windowShow > 0 && (
        <div
          style={{
            position: "absolute",
            left: WINDOW.x,
            top: WINDOW.y,
            width: WINDOW.w,
            height: WINDOW.h,
            borderRadius: 26,
            border: `2px solid ${P.hair}`,
            background: P.island,
            boxShadow: "0 30px 80px rgba(60,36,20,.12)",
            opacity: windowShow * (1 - closed * 0.7),
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 26px", fontFamily: MONO, fontSize: 22, color: P.ink2 }}>
            {[0, 1, 2].map((d) => (
              <span key={d} style={{ width: 15, height: 15, borderRadius: 99, background: P.hair }} />
            ))}
            <span style={{ marginLeft: 16, padding: ch === 7 ? "4px 18px" : 0, borderRadius: 99, background: ch === 7 ? P.canvas : "none" }}>
              {ch === 7 ? "127.0.0.1:7878" : "rove"}
            </span>
          </div>
        </div>
      )}

      <Row
        y={SLOT_Y[0]}
        frame={frame}
        born={C0}
        glyph={frame >= DONE0 ? "done" : "run"}
        title={c.fix}
        engine="claude"
        fade={fade(0, C0)}
        sub={
          <>
            ⎇ {BRANCH[0]}
            {frame >= CHECKS && <span style={{ color: P.greenText }}> · {c.checks}</span>}
          </>
        }
        after={
          frame >= PR && (
            <Tag show={rise(frame, PR, 14)} accent>
              PR #128{frame >= CHECKS && <span style={{ color: P.greenText }}> ✓</span>}
            </Tag>
          )
        }
      />
      <Row
        y={SLOT_Y[1]}
        frame={frame}
        born={C1}
        glyph={asking ? "ask" : "run"}
        title={c.review}
        engine="codex"
        fade={fade(1, C1)}
        sub={asking ? <span style={{ color: AMBER }}>{c.needsInput}</span> : <>⎇ {BRANCH[1]}</>}
      />
      <Row y={SLOT_Y[2]} frame={frame} born={C2} glyph="run" title={c.big} engine="claude" fade={fade(2, C2)} sub={frame >= KIDS[0] ? c.handSub : undefined} />
      {KIDS.map((born, k) => (
        <Row
          key={k}
          kid
          y={KID_Y[k]}
          frame={frame}
          born={born}
          glyph={(k === 0 && frame >= REPORT) || (k === 1 && frame >= KID_DONE) ? "done" : "run"}
          title={c.handRows[k]}
          engine={WORKERS[k]}
          fade={fade(2, C2)}
        />
      ))}
      <Row
        y={SLOT_Y[3]}
        frame={frame}
        born={C3}
        glyph="routine"
        title={c.routine}
        engine="claude"
        fade={fade(3, C3)}
        sub={c.scheduleSub}
      />

      {live && frame < live[4] && (
        <Live y={SLOT_Y[live[0]]} frame={frame} text={typed(live[1], frame, live[2], live[3])} typing={frame >= live[2] && frame < live[3]} />
      )}

      {ch === 0 && (
        <Popup x={TEXT_X} y={SLOT_Y[0] + 96} show={rise(frame, at(0, 30)) * out(C0)}>
          <span style={{ fontWeight: 700, marginRight: 26 }}>{c.newTask}</span>
          <span style={label}>{c.worktree}</span>⎇ {typed(BRANCH[0], frame, at(0, 40), at(0, 100))}
          <span style={{ ...label, marginLeft: 26 }}>{c.engine}</span>
          <Sel on>claude</Sel>
        </Popup>
      )}
      {ch === 1 && (
        <Popup x={TEXT_X} y={SLOT_Y[1] + 96} show={rise(frame, at(1, 18)) * out(C1)}>
          {ENGINES.map((e, i) => (
            <span key={e} style={{ marginRight: 8 }}>
              <Sel on={i === engineSel}>{e}</Sel>
            </span>
          ))}
          <span style={{ color: P.ink2, marginLeft: 10 }}>{c.more}</span>
        </Popup>
      )}
      {ch === 2 && cmd >= 0 && (
        <Popup x={TEXT_X} y={604} show={rise(frame, CMD[0])}>
          {frame >= REPORT ? (
            <>
              <Sel on>codex</Sel>
              <span style={{ ...label, marginLeft: 12 }}>→ claude</span>
              <span style={{ color: P.greenText }}>{c.report}</span>
            </>
          ) : (
            <>
              <Sel on>claude</Sel>
              <span style={{ color: P.accent, margin: "0 12px" }}>❯</span>
              {typed(`rove api add --command ${WORKERS[cmd]} --prompt "${c.handRows[cmd]}"`, frame, CMD[cmd], CMD[cmd] + CMD_LEN)}
              <Caret frame={frame} solid />
            </>
          )}
        </Popup>
      )}
      {ch === 4 && (
        <Popup x={-14} y={SLOT_Y[1] + 112} width={860} show={rise(frame, at(4, 40)) * out(ANSWERED)}>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
            <span style={{ color: P.accentText }}>{c.inbox} 1</span>
            <span style={{ color: AMBER }}>? {c.needsInput} · 3m</span>
          </div>
          <div style={{ margin: "12px 0", fontFamily: SANS, fontSize: 30 }}>
            <span style={label}>codex</span>
            {c.question}
          </div>
          <div style={{ borderTop: `1px solid ${P.hair}`, paddingTop: 12, fontSize: 30 }}>
            <span style={{ color: P.accent, marginRight: 14 }}>❯</span>
            {typed(c.reply, frame, at(4, 70), at(4, 118))}
            <Caret frame={frame} solid={frame < at(4, 118)} />
          </div>
        </Popup>
      )}
      {ch === 6 && (
        <Popup x={TEXT_X} y={SLOT_Y[3] + 96} show={rise(frame, at(6, 20)) * out(C3)}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
            {c.cron.map((name, i) => (
              <div key={name} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, color: P.ink2, marginBottom: 6 }}>{name}</div>
                <div
                  style={{
                    minWidth: 74,
                    padding: "8px 0",
                    borderRadius: 10,
                    fontSize: 30,
                    border: `2px solid ${i === 1 ? P.accent : P.hair}`,
                    color: i === 1 && hourSet ? P.accentText : P.ink,
                  }}
                >
                  {i === 0 ? "0" : i === 1 && hourSet ? "9" : "*"}
                </div>
              </div>
            ))}
            <span style={{ marginLeft: 16, paddingBottom: 10, color: P.ink2, opacity: rise(frame, at(6, 88)) }}>→ {c.schedule}</span>
          </div>
        </Popup>
      )}

      {closed > 0 && (
        <div style={{ position: "absolute", left: TEXT_X, top: 628, opacity: closed, fontFamily: MONO, fontSize: 30, color: P.ink2, whiteSpace: "nowrap" }}>
          {c.closed} · <span style={{ color: P.accentText }}>{c.stillWorking}</span>
          <div style={{ marginTop: 14, fontSize: 40, color: P.ink, opacity: rise(frame, at(3, 104)) }}>
            <span style={{ color: P.ink2 }}>$ </span>
            {typed("rove", frame, at(3, 112), at(3, 124))}
            <Caret frame={frame} />
          </div>
        </div>
      )}
    </>
  )
}

/** The same list on a paired phone: same rows, same status marks, same beat. */
export const PhoneList: React.FC<{ frame: number; c: Strings }> = ({ frame, c }) => {
  const rows: [GlyphKind, string, string][] = [
    ["done", c.fix, "claude · PR #128"],
    ["run", c.review, "codex"],
    ["run", c.big, c.handSub],
    ["routine", c.routine, c.scheduleSub],
  ]
  return (
    <>
      {rows.map(([glyph, title, sub], i) => (
        <div key={i} style={{ display: "flex", gap: 12, padding: "13px 0", borderBottom: `1px solid ${P.hair}`, fontFamily: MONO }}>
          <span style={{ fontSize: 20, width: 20 }}>
            <Glyph kind={glyph} frame={frame} phase={SLOT_Y[i]} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 19, color: P.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: 232 }}>
              {title}
            </div>
            <div style={{ fontSize: 14, color: P.ink2, marginTop: 4 }}>{sub}</div>
          </div>
        </div>
      ))}
    </>
  )
}
