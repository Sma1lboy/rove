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
  const sessionId = `visual-${runId}`
  const [status, setStatus] = useState<WsStatus>("connecting")
  const [buffer, setBuffer] = useState("")

  return (
    <div
      data-testid="opentui-harness"
      data-pty-status={status}
      style={{ position: "fixed", inset: 0, background: "#141413" }}
    >
      <ChatTerminal
        tabId={sessionId}
        taskId={sessionId}
        mode="shell"
        testId="opentui-terminal"
        disableWebgl={!useWebgl}
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
