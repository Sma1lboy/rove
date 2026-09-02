import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { ChatTerminal, type WsStatus } from "../components/ChatTerminal.tsx"
import { resolveHarnessRenderer } from "../lib/harness-renderer.ts"

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
  // Renderer policy belongs to the one capture boundary, not to every script
  // that opens it. Opaque captures use WebGL and transparent captures use
  // Canvas inside ChatTerminal; both draw custom block glyphs without gaps.
  // `?renderer=dom` remains a diagnostic comparison path.
  const renderer = resolveHarnessRenderer(
    new URLSearchParams(window.location.search),
  )
  // `?wallpaper=<path>` paints a backdrop behind the terminal. Same-origin
  // paths only: this route renders whatever it is handed, and a capture URL is
  // not a place to accept an arbitrary remote image.
  const wallpaperParam = new URLSearchParams(window.location.search).get(
    "wallpaper",
  )
  const wallpaper = wallpaperParam?.startsWith("/") ? wallpaperParam : null
  // `?hostbg=<#rrggbb>` simulates a host terminal whose background IS that
  // color (light-theme terminal, dark-theme terminal — the contrast-guard
  // matrix). The page paints it behind the terminal AND hands it to xterm as
  // its `theme.background`, so OSC 11 queries report the color the user
  // actually sees and the TUI adapts to it through the real detection path.
  const hostbgParam = new URLSearchParams(window.location.search).get("hostbg")
  const hostbg =
    hostbgParam && /^#[0-9a-fA-F]{6}$/.test(hostbgParam) ? hostbgParam : null
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
        // instead of a rectangle of #141413. Plain colour when unset;
        // `?hostbg=` replaces it with the simulated host terminal color.
        background: wallpaper
          ? `#0F0E0D url("${wallpaper}") center/cover no-repeat`
          : (hostbg ?? "#141413"),
      }}
    >
      {/*
        xterm paints `.xterm-viewport` — its scroll surface — an opaque black
        regardless of the theme background or `allowTransparency`, so a page
        backdrop never shows through no matter how transparent every other
        layer is. Overriding it is what actually makes the terminal sit ON the
        wallpaper (or the simulated host color). Scoped to the transparent
        cases so normal use keeps xterm's own (correct, cheaper) opaque
        surface.
      */}
      {wallpaper || hostbg ? (
        <style>
          {".xterm-viewport{background-color:transparent !important}"}
        </style>
      ) : null}
      <ChatTerminal
        tabId={sessionId}
        taskId={sessionId}
        mode="shell"
        testId="opentui-terminal"
        renderer={renderer}
        transparent={wallpaper !== null || hostbg !== null}
        hostBackground={hostbg ?? undefined}
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
