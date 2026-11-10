import { AbsoluteFill } from "remotion"
import { MONO, Marked, P, SANS, Wordmark, statement } from "./promo-theme"

// `rove plugin search` output copied verbatim, minus its trailing row for the repo itself.
const SEARCH: readonly [string, string][] = [
  ["Sma1lboy/rove-plugins/notify", "Desktop/ntfy notifications when an agent finishes or needs input"],
  ["Sma1lboy/rove-plugins/github-start", "Start a Rove task from a GitHub issue or PR"],
  ["Sma1lboy/rove-plugins/worktree-include", "Copy .worktreeinclude-matched files into new worktrees"],
  ["Sma1lboy/rove-plugins/linear-start", "Pick a Linear issue (fzf) and start a task on its branch"],
  ["Sma1lboy/rove-plugins/lazygit", "lazygit on the task worktree, as a pane tab"],
  ["Sma1lboy/rove-plugins/browser", "Chromium rendered as terminal cells (carbonyl) in a pane tab"],
]

const prompt = <span style={{ color: P.accentText, fontWeight: 700 }}>$</span>

const Chrome: React.FC<{ title: string }> = ({ title }) => (
  <div
    style={{
      height: 42,
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "0 16px",
      background: "#EFE9E0",
      borderBottom: `1px solid ${P.hair}`,
    }}
  >
    {[0, 1, 2].map((i) => (
      <span key={i} style={{ width: 12, height: 12, borderRadius: "50%", background: "#D9D0C4" }} />
    ))}
    <span style={{ flex: 1, textAlign: "center", marginRight: 52, fontFamily: SANS, fontSize: 15, color: P.ink2 }}>
      {title}
    </span>
  </div>
)

const card: React.CSSProperties = {
  position: "absolute",
  borderRadius: 20,
  overflow: "hidden",
  background: P.island,
  boxShadow: "0 28px 64px rgba(60,30,16,.13), 0 0 0 1px rgba(60,30,16,.10)",
}

const Button: React.FC<{ label: string; tone: string }> = ({ label, tone }) => (
  <span
    style={{
      display: "inline-block",
      padding: "3px 14px",
      border: `1.5px solid ${tone}`,
      borderRadius: 8,
      color: tone,
      fontWeight: 700,
    }}
  >
    {label}
  </span>
)

/** One mod pane, as both clients draw it from the same element tree. */
const ModPane: React.FC = () => (
  <div style={{ fontFamily: MONO, fontSize: 15, lineHeight: "28px", color: P.ink }}>
    <div style={{ fontWeight: 700 }}>
      Counter <span style={{ color: P.ink2, fontWeight: 400 }}>· examples.counter-mod</span>
    </div>
    <div style={{ fontWeight: 700, marginTop: 4 }}>Count: 2</div>
    <div style={{ display: "flex", gap: 12, margin: "8px 0" }}>
      <Button label="+1" tone={P.greenText} />
      <Button label="-1" tone="#2F6FA8" />
      <Button label="Reset" tone="#A0761C" />
    </div>
    <div
      style={{
        border: `1px solid ${P.hair}`,
        borderRadius: 8,
        padding: "2px 12px",
        color: "#9A9086",
        background: "#FBF7F2",
      }}
    >
      Add a note and press Enter
    </div>
    <div style={{ marginTop: 6 }}>• from the TUI</div>
    <div>• from the browser</div>
  </div>
)

export const PromoPlugins: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: P.canvas, color: P.ink }}>
    <div style={{ ...statement(104), position: "absolute", left: 96, top: 70 }}>
      Make it{" "}
      <span style={{ color: P.island }}>
        <Marked>yours.</Marked>
      </span>
    </div>
    <div
      style={{
        position: "absolute",
        left: 100,
        top: 196,
        width: 900,
        fontFamily: SANS,
        fontSize: 30,
        lineHeight: 1.3,
      }}
    >
      Panes, event hooks, commands, settings, whole engines. And mods: one UI the TUI and the browser both draw.
    </div>

    <div style={{ ...card, left: 96, top: 412, width: 1130 }}>
      <Chrome title="zsh" />
      <div
        style={{
          padding: "22px 30px 26px",
          fontFamily: MONO,
          fontSize: 15,
          lineHeight: "31px",
          color: P.ink,
          whiteSpace: "pre",
        }}
      >
        <div>{prompt} rove plugin search</div>
        {SEARCH.map(([id, what]) => (
          <div key={id}>
            <span style={{ fontWeight: 700 }}>{id.padEnd(40)}</span>
            <span style={{ color: P.greenText }}>first-party</span> <span style={{ color: P.ink2 }}>{what}</span>
          </div>
        ))}
        <div> </div>
        <div>
          {prompt} rove plugin install Sma1lboy/rove-plugins/lazygit
          <span style={{ display: "inline-block", width: 10, height: 21, background: P.accent, verticalAlign: -4 }} />
        </div>
      </div>
    </div>

    <div style={{ ...card, left: 1150, top: 96, width: 354 }}>
      <Chrome title="Mods · TUI + web" />
      <div style={{ padding: "16px 20px 20px" }}>
        <ModPane />
      </div>
    </div>

    <Wordmark size={30} ink={P.ink} bracket={P.accent} style={{ position: "absolute", right: 98, bottom: 54 }} />
  </AbsoluteFill>
)
