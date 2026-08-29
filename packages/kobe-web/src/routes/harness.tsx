import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { ChatTerminal, type WsStatus } from "../components/ChatTerminal.tsx"

/**
 * `/harness` — the one fixed-viewport observation surface for the real
 * OpenTUI. The PTY runs `KOBE_PTY_DEV_COMMAND`; visual acceptance always sets
 * that to `dev:sandbox`. The hidden buffer is synchronization/diagnostics only
 * — screenshots still capture xterm's rendered pixels.
 */
function PtyHarness() {
  const rawRun =
    new URLSearchParams(window.location.search).get("run") ?? "manual"
  const runId = rawRun.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "manual"
  // `?webgl=1` opts INTO the WebGL renderer. The DOM renderer stays the
  // default because it cannot fail to initialize, but it renders every cell
  // as its own span using the font — and xterm's `customGlyphs`, which draws
  // block-element and box-drawing characters geometrically so they tile with
  // no seam, is documented as DOM-renderer-incompatible. Engine banner art
  // (Claude Code's logo is `▛█▝▀`) therefore photographs with a gap in every
  // cell. Recordings turn this on; a WebGL context that fails to come up
  // falls back to DOM inside ChatTerminal, so the switch cannot break a take.
  const useWebgl =
    new URLSearchParams(window.location.search).get("webgl") === "1"
  // `?wallpaper=<path>` paints a backdrop behind the terminal. Same-origin
  // paths only: this route renders whatever it is handed, and a capture URL is
  // not a place to accept an arbitrary remote image.
  const wallpaperParam = new URLSearchParams(window.location.search).get(
    "wallpaper",
  )
  const wallpaper = wallpaperParam?.startsWith("/") ? wallpaperParam : null
  const sessionId = `visual-${runId}`
  const [status, setStatus] = useState<WsStatus>("connecting")
  const [buffer, setBuffer] = useState("")

  return (
    <div
      data-testid="opentui-harness"
      data-pty-status={status}
      style={{
        position: "fixed",
        inset: 0,
        // `?wallpaper=<url>` paints behind the terminal. The TUI defaults to a
        // transparent background (`transparentBackground`, persisted-ui-prefs),
        // so whatever sits here shows through the cells the product does not
        // paint — which is how a capture can look like a terminal on a desktop
        // instead of a rectangle of #141413. Plain colour when unset.
        background: wallpaper
          ? `#0F0E0D url("${wallpaper}") center/cover no-repeat`
          : "#141413",
      }}
    >
      {/*
        xterm paints `.xterm-viewport` — its scroll surface — an opaque black
        regardless of the theme background or `allowTransparency`, so a page
        backdrop never shows through no matter how transparent every other
        layer is. Overriding it is what actually makes the terminal sit ON the
        wallpaper. Scoped to the wallpaper case so normal use keeps xterm's own
        (correct, cheaper) opaque surface.
      */}
      {wallpaper ? (
        <style>
          {".xterm-viewport{background-color:transparent !important}"}
        </style>
      ) : null}
      <ChatTerminal
        tabId={sessionId}
        taskId={sessionId}
        mode="shell"
        testId="opentui-terminal"
        disableWebgl={!useWebgl}
        transparent={wallpaper !== null}
        onStatusChange={setStatus}
        onBufferChange={setBuffer}
      />
      <pre data-testid="opentui-buffer" style={{ display: "none" }}>
        {buffer}
      </pre>
    </div>
  )
}

export const Route = createFileRoute("/harness")({ component: PtyHarness })
