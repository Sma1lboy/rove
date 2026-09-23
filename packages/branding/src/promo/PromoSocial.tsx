import { AbsoluteFill } from "remotion"
import { CellGrid, ENGINES, MONO, P, SANS, Wordmark, statement } from "./promo-theme"

// GitHub social preview (repo Settings → Social preview): the film's end card, engine ids as texture.

const ids = (list: readonly (readonly [string, string])[]) => list.map(([, id]) => id).join(" · ")

export const PromoSocial: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: P.night, color: P.paper }}>
    <CellGrid />
    <Wordmark size={112} ink={P.paper} bracket={P.accent} style={{ position: "absolute", left: 76, top: 92 }} />
    <div style={{ position: "absolute", right: 80, top: 112, fontFamily: MONO, fontSize: 22, color: P.paper2 }}>
      rove.run
    </div>
    <div style={{ ...statement(56), position: "absolute", left: 80, top: 262 }}>
      The agent multiplexer for your <span style={{ color: P.accentOnNight }}>terminal.</span>
    </div>
    <div style={{ position: "absolute", left: 80, top: 346, fontFamily: SANS, fontSize: 27, color: P.paper2 }}>
      Every task gets its own git worktree, branch, and agent session.
    </div>
    <div
      style={{
        position: "absolute",
        left: 80,
        top: 418,
        display: "flex",
        alignItems: "center",
        gap: 16,
        height: 62,
        padding: "0 26px",
        borderRadius: 16,
        border: "2px solid rgba(239,233,223,.16)",
        background: "rgba(239,233,223,.04)",
        fontFamily: MONO,
        fontSize: 25,
      }}
    >
      <span style={{ color: P.accentOnNight }}>$</span>npm i -g @sma1lboy/rove
    </div>
    <div
      style={{
        position: "absolute",
        left: 80,
        right: 80,
        bottom: 44,
        fontFamily: MONO,
        fontSize: 17.5,
        lineHeight: "28px",
        color: "#8F877D",
      }}
    >
      <span style={{ color: P.paper2 }}>{ids(ENGINES.builtIn)}</span> · {ids(ENGINES.catalog)} · + any CLI you register
    </div>
  </AbsoluteFill>
)
