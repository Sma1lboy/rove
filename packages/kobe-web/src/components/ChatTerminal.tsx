/**
 * ChatTerminal — a live xterm.js attached (over the PTY WebSocket) to one
 * PTY-backed workspace tab. Vendor tabs run the selected engine; terminal
 * tabs run the user's shell. Keyed by tab id in the parent so switching tabs
 * swaps terminals while the PTY persists server-side across reconnects.
 *
 * Engine tabs get a prompt composer under the terminal: a textarea whose
 * submit pastes into the engine via bracketed paste + Enter (the same
 * delivery contract as kobe's tmux `pasteAndSubmit`), so driving a session
 * doesn't require terminal typing ergonomics. A dropped socket shows a
 * Reattach affordance — the PTY survives server-side and replays its
 * scrollback ring on re-attach, so reattaching is loss-free.
 */

import { ClipboardAddon } from "@xterm/addon-clipboard"
import { FitAddon } from "@xterm/addon-fit"
import { Unicode11Addon } from "@xterm/addon-unicode11"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { RotateCw } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { type PtyMode, ptyUrl } from "../lib/terminal.ts"
import {
  loadTerminalRenderer,
  type TerminalRendererMode,
} from "../lib/terminal-renderer.ts"
import { xtermTheme } from "../lib/theme.ts"

// One decoder reused across every WebSocket message — a fresh `new
// TextDecoder()` per frame (hundreds/sec during engine streaming) was needless
// allocation churn. Stateless here: each binary frame is a self-contained UTF-8
// chunk, decoded in one `decode()` call with no streaming state carried over.
const PTY_DECODER = new TextDecoder()

// xterm palette mirrored from the claude TUI theme (claude.json).
const CLAUDE_XTERM_THEME = {
  background: "#141413",
  foreground: "#eae7df",
  cursor: "#cc785c",
  cursorAccent: "#141413",
  selectionBackground: "#33312e",
  black: "#141413",
  red: "#d47563",
  green: "#9aca86",
  yellow: "#e8c96b",
  blue: "#61aaf2",
  magenta: "#9b87f5",
  cyan: "#d4967e",
  white: "#a9a39a",
  brightBlack: "#6b665f",
  brightRed: "#d47563",
  brightGreen: "#9aca86",
  brightYellow: "#e8c96b",
  brightBlue: "#61aaf2",
  brightMagenta: "#9b87f5",
  brightCyan: "#e0ab96",
  brightWhite: "#eae7df",
} as const

const TERMINAL_FONT_FAMILY =
  '"JetBrains Mono", "JetBrainsMono Nerd Font", "MesloLGS NF", "Symbols Nerd Font Mono", "SF Mono", ui-monospace, Menlo, monospace'

/**
 * Families in {@link TERMINAL_FONT_FAMILY} that the browser must have resolved
 * before the terminal is worth photographing. The bundled JetBrains Mono is a
 * LATIN subset, so every icon glyph an engine draws (`▶`, branch and status
 * symbols) necessarily falls through to a Nerd Font — a family the page never
 * asks for until something actually renders that character.
 */
const TERMINAL_FONT_FAMILIES = [
  '"JetBrains Mono"',
  '"JetBrainsMono Nerd Font"',
  '"MesloLGS NF"',
  '"Symbols Nerd Font Mono"',
] as const

/**
 * Warm every family in the stack, not just the first.
 *
 * `document.fonts.load()` resolves one family at a time, so awaiting only
 * JetBrains Mono leaves the Nerd Fonts to load lazily — i.e. after the first
 * frame that needs them. Interactively nobody notices; a scripted capture
 * screenshots the frame in between and photographs missing-glyph boxes (`▯▯`
 * in place of `▶▶`) where the icons belong. Each family is settled
 * independently so an absent
 * one (a machine without Nerd Fonts) cannot block the others.
 */
async function loadTerminalFont(): Promise<void> {
  if (!("fonts" in document)) return
  await Promise.allSettled(
    TERMINAL_FONT_FAMILIES.map((family) =>
      document.fonts.load(`12px ${family}`),
    ),
  )
  try {
    // The per-family loads above cover the stack; `ready` covers anything else
    // the page is still fetching, so layout is settled before the first paint
    // a capture might grab.
    await document.fonts.ready
  } catch {
    /* fallback font stack still renders if the bundled font fails */
  }
}

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

      term = new Terminal({
        // Active TUI-synced palette when loaded; static claude otherwise.
        theme: transparent
          ? {
              ...(xtermTheme() ?? CLAUDE_XTERM_THEME),
              // Opaque host color when the harness simulates one (so OSC 11
              // reports it); near-invisible black otherwise so the page
              // backdrop shows through the unpainted cells.
              background: hostBackground ?? "rgba(0,0,0,0.01)",
            }
          : (xtermTheme() ?? CLAUDE_XTERM_THEME),
        allowTransparency: transparent,
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: 12,
        cursorBlink: true,
        allowProposedApi: true,
        scrollback: 5000,
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      // Unicode 11 widths: default Unicode 6 measures emoji as one cell,
      // desyncing wrap/cursor from what the server-side PTY apps assume.
      term.loadAddon(new Unicode11Addon())
      term.unicode.activeVersion = "11"
      // OSC 52 → navigator.clipboard, so in-terminal copy (tmux/engine
      // copy chords) lands on the viewer's clipboard across the web gap.
      term.loadAddon(new ClipboardAddon())
      // Plain URLs in engine output become clickable.
      term.loadAddon(new WebLinksAddon())
      term.open(el)
      // The visual harness normally keeps this renderer policy. Its explicit
      // DOM diagnostic mode skips both accelerated addons; buffer reads stay
      // renderer-independent either way. Renderer choice is a three-way trade:
      //
      //   DOM    — always available, but each cell is its own span drawn with
      //            the font, so `customGlyphs` is off and block-drawing
      //            characters show a seam at every cell boundary.
      //   WebGL  — tiles those glyphs correctly, but fills default-background
      //            cells as solid colour, which turns into black boxes the
      //            moment the background is transparent.
      //   Canvas — draws glyphs the same way WebGL does, on a 2D context that
      //            composites over what is behind it.
      //
      // So transparency picks Canvas and opacity picks WebGL. Opaque WebGL
      // failures fall through Canvas before the final DOM fallback.
      loadTerminalRenderer(term, renderer, transparent)
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
