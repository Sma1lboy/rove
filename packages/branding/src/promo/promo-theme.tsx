// Promo stills theme: the launch film's palette and its two voices, Instrument Sans for
// what you'd say and JetBrains Mono for what you'd type. Rendered into ../../docs/assets/brand/promo-*.

import { loadFont as loadSans } from "@remotion/google-fonts/InstrumentSans"
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono"
import { AbsoluteFill } from "remotion"

loadSans("normal", { weights: ["400", "500", "600"], subsets: ["latin"] })
loadMono("normal", { weights: ["400", "700"], subsets: ["latin"] })

export const P = {
  canvas: "#FAF8F5",
  island: "#FFFDF9",
  ink: "#211C18",
  ink2: "#5F574F",
  hair: "#E6DFD5",
  accent: "#C46B48",
  accentText: "#A4532F", // the accent darkened to pass AA as text on the canvas
  accentOnNight: "#E58F6B",
  greenText: "#2F7448",
  night: "#141413",
  paper: "#EFE9DF",
  paper2: "#B3AA9F",
} as const

export const SANS = '"Instrument Sans", system-ui, sans-serif'
export const MONO = '"JetBrains Mono", ui-monospace, monospace'

// Mirrors BUILTIN_VENDORS and CONTRIB_ENGINES in packages/kobe: re-render with `bun run still:promo` when either changes.
export const ENGINES = {
  builtIn: [
    ["Claude Code", "claude"],
    ["Codex", "codex"],
    ["GitHub Copilot", "copilot"],
    ["Kimi Code", "kimi"],
    ["Pi", "pi"],
    ["OMP", "omp"],
  ],
  catalog: [
    ["Gemini CLI", "gemini"],
    ["OpenCode", "opencode"],
    ["Cursor Agent", "cursor"],
    ["Grok CLI", "grok"],
    ["Droid", "droid"],
    ["Amp", "amp"],
    ["Devin", "devin"],
    ["Qoder CLI", "qodercli"],
    ["Cline", "cline"],
    ["Kiro CLI", "kiro"],
    ["Maki", "maki"],
    ["Antigravity", "antigravity"],
  ],
} as const

export const statement = (size: number): React.CSSProperties => ({
  fontFamily: SANS,
  fontWeight: 600,
  fontSize: size,
  letterSpacing: "-0.03em",
  lineHeight: 1.02,
  whiteSpace: "nowrap",
})

export const Wordmark: React.FC<{ size: number; ink: string; bracket: string; style?: React.CSSProperties }> = ({
  size,
  ink,
  bracket,
  style,
}) => (
  <div
    style={{
      fontFamily: MONO,
      fontWeight: 700,
      fontSize: size,
      letterSpacing: "0.02em",
      whiteSpace: "nowrap",
      color: ink,
      ...style,
    }}
  >
    <span style={{ color: bracket }}>[</span>
    {" rove "}
    <span style={{ color: bracket }}>]</span>
  </div>
)

/** The film's highlight: a terracotta block behind one word. */
export const Marked: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ position: "relative", padding: "0 0.1em" }}>
    <span style={{ position: "absolute", inset: "0.1em 0 0.02em 0", background: P.accent, borderRadius: "0.06em" }} />
    <span style={{ position: "relative" }}>{children}</span>
  </span>
)

/** The film's graphite keycap. */
export const Keycap: React.FC<{ children: React.ReactNode; mono?: boolean }> = ({ children, mono }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: 76,
      height: 76,
      padding: "0 20px",
      borderRadius: 18,
      background: "linear-gradient(180deg, #2b2724 0%, #1c1916 100%)",
      boxShadow: "inset 0 2px 0 rgba(255,255,255,.10), inset 0 -6px 0 rgba(0,0,0,.35), 0 14px 30px rgba(26,12,6,.35)",
      color: P.paper,
      fontFamily: mono ? MONO : SANS,
      fontWeight: mono ? 700 : 500,
      fontSize: mono ? 32 : 34,
      letterSpacing: mono ? 0 : "-0.02em",
    }}
  >
    {children}
  </span>
)

/** The end card's faint terminal-cell grid. */
export const CellGrid: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundImage:
        "linear-gradient(rgba(234,231,223,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(234,231,223,.045) 1px, transparent 1px)",
      backgroundSize: "30px 44px",
    }}
  />
)
