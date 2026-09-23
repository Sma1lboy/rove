import { AbsoluteFill } from "remotion"
import { ENGINES, MONO, P, SANS, Wordmark, statement } from "./promo-theme"

// Engine roster: solid chips ship an adapter, outlined ones come from the catalog, dashed ones are yours.

const chip: React.CSSProperties = {
  height: 58,
  display: "inline-flex",
  alignItems: "center",
  padding: "0 22px",
  borderRadius: 16,
  fontFamily: SANS,
  fontWeight: 500,
  fontSize: 27,
  letterSpacing: "-0.015em",
  whiteSpace: "nowrap",
}
const builtIn: React.CSSProperties = {
  ...chip,
  background: P.island,
  border: "2px solid #D9CFC2",
  boxShadow: "0 6px 16px rgba(60,30,16,.07)",
}
const catalog: React.CSSProperties = { ...chip, border: `2px solid ${P.hair}`, color: "#3B342E" }
const yours: React.CSSProperties = {
  ...chip,
  border: `2px dashed ${P.accent}`,
  color: P.accentText,
  background: "rgba(246,228,219,.45)",
}

const Group: React.FC<{ title: string; note?: string; children: React.ReactNode }> = ({ title, note, children }) => (
  <div>
    <div
      style={{
        marginBottom: 14,
        fontFamily: MONO,
        fontSize: 17,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: P.ink2,
      }}
    >
      <span style={{ color: P.ink }}>{title}</span>
      {note ? ` · ${note}` : null}
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{children}</div>
  </div>
)

export const PromoEngines: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: P.canvas, color: P.ink }}>
    <div style={{ ...statement(92), position: "absolute", left: 88, top: 84 }}>
      Every agent CLI,
      <br />
      each in its own <span style={{ color: P.accentText }}>worktree.</span>
    </div>
    <Wordmark size={34} ink={P.ink} bracket={P.accent} style={{ position: "absolute", right: 88, top: 100 }} />
    <div
      style={{ position: "absolute", left: 88, right: 88, top: 344, display: "flex", flexDirection: "column", gap: 50 }}
    >
      <Group title="Built in" note="Rove ships the adapter">
        {ENGINES.builtIn.map(([name]) => (
          <span key={name} style={builtIn}>
            {name}
          </span>
        ))}
      </Group>
      <Group title="Catalog" note="listed when the CLI is on your PATH">
        {ENGINES.catalog.map(([name]) => (
          <span key={name} style={catalog}>
            {name}
          </span>
        ))}
      </Group>
      <Group title="Yours">
        <span style={yours}>any command you register</span>
        <span style={yours}>
          <span style={{ fontFamily: MONO, fontSize: 23, fontWeight: 400, marginRight: 10 }}>[[engines]]</span>from a
          plugin
        </span>
      </Group>
    </div>
  </AbsoluteFill>
)
