import { AbsoluteFill } from "remotion"
import { Backdrop, ENGINES, MONO, SANS, T, Wordmark, statement } from "./promo-theme"

const I = T.page

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
  background: I.island,
  border: `2px solid ${I.line}`,
  boxShadow: T.chipShadow,
}
const catalog: React.CSSProperties = { ...chip, border: `2px solid ${I.hair}`, color: I.ink2 }
const yours: React.CSSProperties = {
  ...chip,
  border: `2px dashed ${I.bracket}`,
  color: I.accentText,
  background: I.tint,
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
        color: I.ink2,
      }}
    >
      <span style={{ color: I.ink }}>{title}</span>
      {note ? ` · ${note}` : null}
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{children}</div>
  </div>
)

export const PromoEngines: React.FC = () => (
  <AbsoluteFill style={{ color: I.ink }}>
    <Backdrop />
    <div style={{ ...statement(92), position: "absolute", left: 88, top: 84, textShadow: T.textShadow }}>
      Any agent CLI.
      <br />
      Pick one <span style={{ color: I.accentText }}>per task.</span>
    </div>
    <Wordmark size={34} ink={I.ink} bracket={I.bracket} style={{ position: "absolute", right: 88, top: 100 }} />
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
