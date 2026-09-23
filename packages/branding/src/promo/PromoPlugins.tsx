import { AbsoluteFill, Img, staticFile } from "remotion"
import { MONO, Marked, P, SANS, Wordmark, statement } from "./promo-theme"

// `rove plugin search` output copied verbatim, minus its trailing row for the repo itself.
const SEARCH: readonly [string, string][] = [
  ["Sma1lboy/kobe-plugins/notify", "Desktop/ntfy notifications when an agent finishes or needs input"],
  ["Sma1lboy/kobe-plugins/github-start", "Start a Rove task from a GitHub issue or PR"],
  ["Sma1lboy/kobe-plugins/worktree-include", "Copy .worktreeinclude-matched files into new worktrees"],
  ["Sma1lboy/kobe-plugins/linear-start", "Pick a Linear issue (fzf) and start a task on its branch"],
  ["Sma1lboy/kobe-plugins/lazygit", "lazygit on the task worktree, as a pane tab"],
  ["Sma1lboy/kobe-plugins/browser", "Chromium rendered as terminal cells (carbonyl) in a pane tab"],
]

const onWallpaper: React.CSSProperties = { color: "#FFFAF5", textShadow: "0 4px 28px rgba(60,18,6,.35)" }
const prompt = <span style={{ color: P.accentText, fontWeight: 700 }}>$</span>

export const PromoPlugins: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#B8583B" }}>
    <Img src={staticFile("promo/wall-dusk.jpg")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    <div style={{ ...statement(104), ...onWallpaper, position: "absolute", left: 96, top: 78 }}>
      Make it <Marked>yours.</Marked>
    </div>
    <div style={{ ...onWallpaper, position: "absolute", left: 100, top: 206, fontFamily: SANS, fontSize: 33 }}>
      Plugins add panes, event hooks, commands, settings, and whole engines.
    </div>
    <Wordmark size={32} ink="#FFFAF5" bracket="#FFFAF5" style={{ ...onWallpaper, position: "absolute", right: 96, top: 104 }} />
    <div
      style={{
        position: "absolute",
        left: 112,
        top: 318,
        width: 1376,
        borderRadius: 22,
        overflow: "hidden",
        background: P.island,
        boxShadow: "0 40px 90px rgba(46,18,8,.38), 0 0 0 1px rgba(60,30,16,.12)",
      }}
    >
      <div
        style={{
          height: 46,
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "0 18px",
          background: "#EFE9E0",
          borderBottom: `1px solid ${P.hair}`,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 13, height: 13, borderRadius: "50%", background: "#D9D0C4" }} />
        ))}
        <span style={{ flex: 1, textAlign: "center", marginRight: 57, fontFamily: SANS, fontSize: 16, color: P.ink2 }}>
          zsh
        </span>
      </div>
      <div
        style={{
          padding: "26px 34px 30px",
          fontFamily: MONO,
          fontSize: 18,
          lineHeight: "35px",
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
        <div style={{ color: P.ink2 }}>
          install: rove plugin install &lt;owner/repo[/subdir]&gt; — browse: https://rove.run/plugins
        </div>
        <div>
          {prompt} rove plugin install Sma1lboy/kobe-plugins/lazygit
          <span
            style={{ display: "inline-block", width: 11, height: 23, background: P.accent, verticalAlign: -4 }}
          />
        </div>
      </div>
    </div>
  </AbsoluteFill>
)
