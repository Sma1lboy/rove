// Promo stills theme: the launch film's palette and its two voices, Instrument Sans for
// what you'd say and JetBrains Mono for what you'd type. Rendered into ../../docs/assets/brand/promo-*.

import { loadFont as loadSans } from "@remotion/google-fonts/InstrumentSans"
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono"
import { AbsoluteFill } from "remotion"
import { pickedTone, type Tone } from "../colors"

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

type Inks = {
  ink: string
  ink2: string
  hair: string
  island: string
  line: string
  accentText: string
  bracket: string
  tint: string
  chrome: string
  dot: string
  field: string
  fieldInk: string
  green: string
  blue: string
  amber: string
}

const paperInks: Inks = {
  ink: P.ink,
  ink2: P.ink2,
  hair: P.hair,
  island: P.island,
  line: "#D9CFC2",
  accentText: P.accentText,
  bracket: P.accent,
  tint: "rgba(246,228,219,.45)",
  chrome: "#EFE9E0",
  dot: "#D9D0C4",
  field: "#FBF7F2",
  fieldInk: "#9A9086",
  green: P.greenText,
  blue: "#2F6FA8",
  amber: "#A0761C",
}

const nightInks: Inks = {
  ink: P.paper,
  ink2: P.paper2,
  hair: "#3A3835",
  island: "#1F1E1C",
  line: "#4A4743",
  accentText: P.accentOnNight,
  bracket: P.accentOnNight,
  tint: "rgba(229,143,107,.10)",
  chrome: "#2B2A27",
  dot: "#4A4743",
  field: "#1A1917",
  fieldInk: "#8A8279",
  green: "#9ACA86",
  blue: "#8DB8E0",
  amber: "#E8C96B",
}

const clayInks: Inks = {
  ...paperInks,
  ink: "#FFFAF5",
  ink2: "rgba(255,250,245,.8)",
  hair: "rgba(255,240,228,.32)",
  island: "rgba(255,250,245,.13)",
  line: "rgba(255,240,228,.6)",
  accentText: "#FFD2B8",
  bracket: "#F3B595",
  tint: "rgba(255,250,245,.07)",
}

/** `page` inks sit on the backdrop; `card` inks sit inside a window card. */
const TONES: Record<Tone, { page: Inks; card: Inks; cardShadow: string; chipShadow: string; textShadow?: string }> = {
  paper: {
    page: paperInks,
    card: paperInks,
    cardShadow: "0 28px 64px rgba(60,30,16,.13), 0 0 0 1px rgba(60,30,16,.10)",
    chipShadow: "0 6px 16px rgba(60,30,16,.07)",
  },
  night: { page: nightInks, card: nightInks, cardShadow: "0 0 0 1px #3A3835", chipShadow: "none" },
  clay: {
    page: clayInks,
    card: paperInks,
    cardShadow: "0 40px 90px rgba(40,14,6,.42), 0 0 0 1px rgba(60,30,16,.12)",
    chipShadow: "none",
    textShadow: "0 4px 28px rgba(40,12,4,.35)",
  },
}

export const TONE: Tone = pickedTone ?? "paper"
export const T = TONES[TONE]

export const SANS = '"Instrument Sans", system-ui, sans-serif'
export const MONO = '"JetBrains Mono", ui-monospace, monospace'

// Mirrors BUILTIN_VENDORS and CONTRIB_ENGINES in packages/rove: re-render with `bun run still:promo` when either changes.
export const ENGINES = {
  builtIn: [
    ["Claude Code", "claude"],
    ["Codex", "codex"],
    ["GitHub Copilot", "copilot"],
    ["Kimi Code", "kimi"],
    ["Pi", "pi"],
    ["OMP", "omp"],
    ["IBM Bob", "bob"],
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
    ["Hermes", "hermes"],
    ["Kilo", "kilo"],
    ["MastraCode", "mastracode"],
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

/** The set's background for the picked tone. */
export const Backdrop: React.FC = () => {
  if (TONE === "paper") return <AbsoluteFill style={{ background: P.canvas }} />
  if (TONE === "night")
    return (
      <>
        <AbsoluteFill style={{ background: P.night }} />
        <CellGrid />
      </>
    )
  return (
    <>
      <AbsoluteFill style={{ background: "linear-gradient(160deg, #9C4A2C 0%, #7A3622 45%, #4A2015 100%)" }} />
      <AbsoluteFill
        style={{ background: "radial-gradient(760px 520px at 86% 18%, rgba(240,150,105,.38), transparent 70%)" }}
      />
      <AbsoluteFill
        style={{ background: "radial-gradient(700px 500px at 92% 100%, rgba(30,10,4,.45), transparent 70%)" }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,240,228,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,240,228,.06) 1px, transparent 1px)",
          backgroundSize: "30px 44px",
        }}
      />
    </>
  )
}
