/**
 * ChatTerminal — a live xterm.js attached (over the PTY WebSocket) to one
 * PTY-backed tab. Keyed by tab id in the parent so switching tabs swaps
 * terminals while the PTY persists server-side across reconnects.
 *
 * `mode` still selects engine vs shell on the wire, but `/harness` — the only
 * route that mounts this — hardcodes `mode="shell"`, so engine tabs are not
 * reachable from the product today. The prompt composer that used to sit
 * under an engine terminal went with the browser dashboard in #855.
 *
 * A dropped socket shows a Reattach affordance — the PTY survives
 * server-side and replays its scrollback ring on re-attach, so reattaching
 * is loss-free.
 */

import { FitAddon } from "@xterm/addon-fit"
import type { Terminal } from "@xterm/xterm"
import { RotateCw } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import {
  loadTerminalFont,
  openHarnessTerminal,
} from "../lib/harness-terminal.ts"
import { type PtyMode, ptyUrl } from "../lib/terminal.ts"
import type { TerminalRendererMode } from "../lib/terminal-renderer.ts"

// One decoder reused across every WebSocket message — a fresh `new
// TextDecoder()` per frame (hundreds/sec during engine streaming) was needless
// allocation churn. Stateless here: each binary frame is a self-contained UTF-8
// chunk, decoded in one `decode()` call with no streaming state carried over.
const PTY_DECODER = new TextDecoder()

export type WsStatus = "connecting" | "open" | "closed"

type ChatTerminalProps = {
  tabId: string
  taskId: string
  mode: PtyMode
  testId?: string
  renderer?: TerminalRendererMode
  /**
   * Let whatever is behind the terminal show through the cells the TUI does
   * not paint. The product already renders with a transparent background by
   * default (`transparentBackground` in persisted-ui-prefs) — but xterm paints
   * its OWN opaque `background` underneath, so the host page's backdrop never
   * appears. Screencasts turn this on to sit the terminal on a desktop
   * instead of a flat rectangle; normal use leaves it off, where an opaque
   * canvas is both correct and cheaper to composite.
   *
   * `hostBackground` (harness only) goes one step further for the
   * contrast-guard capture: it sets xterm's `theme.background` to the SAME
   * opaque color the page paints behind the terminal, so OSC 11 background
   * queries report the color the user actually sees — the TUI's transparent-
   * mode contrast guard adapts to it exactly as it would in a real terminal.
   */
  transparent?: boolean
  hostBackground?: string
  onStatusChange?: (status: WsStatus) => void
  onBufferChange?: (text: string) => void
}

function visibleBufferText(term: Terminal): string {
  const buffer = term.buffer.active
  const start = buffer.viewportY
  const end = Math.min(buffer.length, start + term.rows)
  const lines: string[] = []
  for (let index = start; index < end; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? "")
  }
  return lines.join("\n")
}

export function ChatTerminal({
  tabId,
  taskId,
  mode,
  testId,
  renderer = "automatic",
  transparent = false,
  hostBackground,
  onStatusChange,
  onBufferChange,
}: ChatTerminalProps) {
  const ref = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<WsStatus>("connecting")
  // Bumping the epoch tears the terminal down and re-attaches to the
  // SAME server-side PTY (keyed by tab id) — its scrollback ring replays.
  const [epoch, setEpoch] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `epoch` is a deliberate trigger — bumping it tears down + re-attaches to the same server-side PTY (Reattach). It isn't read in the body, so biome thinks it's extraneous, but removing it would break reattach.
  useEffect(() => {
    let disposed = false
    const el = ref.current
    if (!el) return

    let term: Terminal | null = null
    let ws: WebSocket | null = null
    let resizeObserver: ResizeObserver | null = null
    let bufferFrame: number | null = null
    setStatus("connecting")
    onStatusChange?.("connecting")

    const publishBuffer = (): void => {
      if (!term || !onBufferChange || bufferFrame !== null) return
      bufferFrame = requestAnimationFrame(() => {
        bufferFrame = null
        if (!disposed && term) onBufferChange(visibleBufferText(term))
      })
    }

    void (async () => {
      await loadTerminalFont()
      if (disposed) return

      term = openHarnessTerminal(el, {
        renderer,
        transparent,
        hostBackground,
        cursorBlink: true,
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      try {
        fit.fit()
      } catch {
        /* container not measured yet */
      }

      ws = new WebSocket(ptyUrl(tabId, taskId, mode, term.cols, term.rows))
      wsRef.current = ws
      ws.binaryType = "arraybuffer"
      ws.onopen = () => {
        if (!disposed) {
          setStatus("open")
          onStatusChange?.("open")
        }
      }
      ws.onmessage = (e) => {
        // A WS close is async, so a frame already queued can fire after
        // cleanup disposed the terminal — writing to a disposed xterm throws.
        // onopen/onclose already guard on `disposed`; onmessage must too.
        if (disposed) return
        const data =
          typeof e.data === "string"
            ? e.data
            : PTY_DECODER.decode(e.data as ArrayBuffer)
        term?.write(data, publishBuffer)
      }
      ws.onclose = (event) => {
        if (!disposed) {
          const reason = event.reason ? `: ${event.reason}` : ""
          term?.writeln(
            `\r\n[detached${reason} — reattach below]`,
            publishBuffer,
          )
          setStatus("closed")
          onStatusChange?.("closed")
        }
      }
      term.onData((d) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(d)
      })

      const sendResize = (): void => {
        if (!term) return
        try {
          fit.fit()
        } catch {
          return
        }
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "resize",
              cols: term.cols,
              rows: term.rows,
            }),
          )
        }
      }
      resizeObserver = new ResizeObserver(() => sendResize())
      resizeObserver.observe(el)
    })()

    return () => {
      disposed = true
      resizeObserver?.disconnect()
      if (bufferFrame !== null) cancelAnimationFrame(bufferFrame)
      ws?.close()
      term?.dispose()
      wsRef.current = null
    }
  }, [
    tabId,
    taskId,
    mode,
    epoch,
    renderer,
    transparent,
    hostBackground,
    onStatusChange,
    onBufferChange,
  ])

  return (
    <div className="flex h-full w-full flex-col">
      <div
        ref={ref}
        data-testid={testId}
        data-pty-status={testId ? status : undefined}
        className="min-h-0 w-full flex-1 overflow-hidden"
      />
      {status === "closed" ? (
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-t border-line bg-surface px-2">
          <span className="min-w-0 flex-1 truncate text-[11px] text-kobe-yellow">
            detached — the session keeps running
          </span>
          <button
            type="button"
            onClick={() => setEpoch((cur) => cur + 1)}
            className="flex shrink-0 items-center gap-1.5 border border-line bg-bg px-2 py-1 text-[11px] text-muted transition-colors hover:border-primary hover:text-fg"
          >
            <RotateCw size={11} strokeWidth={2} />
            Reattach
          </button>
        </div>
      ) : null}
    </div>
  )
}
