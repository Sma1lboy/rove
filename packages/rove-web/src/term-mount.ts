/**
 * One hosted PTY session in xterm.js: `term.attach` replays the host ring, then
 * `term.data` pushes stream live; keystrokes and resizes go back as `term.input`
 * / `term.resize`. Plain TypeScript around the xterm instance so the React view
 * only owns what it draws (notice, scroll chips, search row).
 */

import { FitAddon } from "@xterm/addon-fit"
import { SearchAddon } from "@xterm/addon-search"
import { Unicode11Addon } from "@xterm/addon-unicode11"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { type BridgeClient, BridgeRequestError } from "./bridge.ts"
import { terminalTheme } from "./prefs-theme.ts"
import { prefsStore } from "./prefs.ts"
import { activeStream } from "./ui.ts"

/** The TUI's default `claude` theme, dark (`tui/context/theme/claude.json`). */
const XTERM_THEME = {
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
}

const FONT_FAMILY = '"JetBrains Mono", "Symbols Nerd Font Mono", "SF Mono", ui-monospace, Menlo, monospace'

/** `DEFAULT_PAGE_SIZE`: lines per `ctrl+pgup` / `ctrl+pgdown`. */
export const SCROLL_PAGE_LINES = 10

export type Notice =
  | { readonly kind: "none" }
  | { readonly kind: "restored" }
  | { readonly kind: "notLive" }
  | { readonly kind: "exited"; readonly code: number | null }
  | { readonly kind: "failed"; readonly message: string }

function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

function streamPayload(data: unknown): { stream: string; data?: string; code?: number | null } | null {
  if (!data || typeof data !== "object" || !("stream" in data) || typeof data.stream !== "string") return null
  return {
    stream: data.stream,
    ...("data" in data && typeof data.data === "string" ? { data: data.data } : {}),
    ...("code" in data && (typeof data.code === "number" || data.code === null) ? { code: data.code } : {}),
  }
}

export interface MountOpts {
  readonly client: BridgeClient
  readonly el: HTMLElement
  readonly taskId: string
  readonly tabId: string
  /** A split pane (`leaf-N`); omitted or `leaf-1` = the tab's own session. */
  readonly leafId?: string
  readonly setNotice: (notice: Notice) => void
  /** Lines above the live screen the viewport sits (0 = following). */
  readonly onScrolled: (lines: number) => void
  /** The terminal took or lost keyboard focus. */
  readonly onFocusChange: (focused: boolean) => void
  /** The pane's process ended. */
  readonly onExit: (code: number | null) => void
  /** Copy-on-release and the copy chords; true = it reached the clipboard. */
  readonly copyText: (text: string) => Promise<boolean>
  readonly focusOnMount: boolean
}

export interface TermHandle {
  readonly term: Terminal
  readonly search: SearchAddon
  readonly stream: string
  /** Attach again (a reset respawned the session under the same key). */
  reattach(): Promise<void>
  dispose(): void
}

export function streamKey(taskId: string, tabId: string, leafId?: string): string {
  return leafId && leafId !== "leaf-1" ? `${taskId}::${tabId}::${leafId}` : `${taskId}::${tabId}`
}

/** Copy chords the browser would not make on its own inside xterm's textarea: Cmd+C, Ctrl+Shift+C, and Ctrl+C with a selection. */
function isCopyChord(e: KeyboardEvent): "interrupt-or-copy" | "copy" | null {
  if (e.type !== "keydown" || e.key.toLowerCase() !== "c" || e.altKey) return null
  if (e.metaKey || (e.ctrlKey && e.shiftKey)) return "copy"
  return e.ctrlKey ? "interrupt-or-copy" : null
}

// Attachments are shared by stream within a connection, including pending replies.
const attachments = new WeakMap<BridgeClient, Map<string, { owners: number; attached: boolean }>>()

export function mountTerminal(o: MountOpts): TermHandle {
  const { client, el, taskId, tabId } = o
  const term = new Terminal({
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    lineHeight: 1.15,
    theme: terminalTheme.get() ?? XTERM_THEME,
    cursorBlink: true,
    scrollback: prefsStore.get().prefs.scrollbackRows,
    allowProposedApi: true,
  })
  const fit = new FitAddon()
  const search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = "11"
  term.loadAddon(new WebLinksAddon())
  term.open(el)
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose())
    term.loadAddon(webgl)
  } catch {
    // The DOM renderer is slower but complete.
  }
  fit.fit()
  if (o.focusOnMount) term.focus()

  const expected = streamKey(taskId, tabId, o.leafId)
  let owned = attachments.get(client)
  if (!owned) {
    owned = new Map()
    attachments.set(client, owned)
  }
  const ownership = owned.get(expected) ?? { owners: 0, attached: false }
  ownership.owners++
  owned.set(expected, ownership)
  const detach = () => void client.request("term.detach", { stream: expected }).catch(() => {})
  let stream: string | null = null
  let alive = false
  let held: Uint8Array[] | null = null
  let disposed = false

  const offData = client.on("term.data", (raw) => {
    const p = streamPayload(raw)
    if (!p?.data || p.stream !== expected) return
    const bytes = decode(p.data)
    if (held) held.push(bytes)
    else if (stream) term.write(bytes)
  })
  const offExit = client.on("term.exit", (raw) => {
    const p = streamPayload(raw)
    if (!p || p.stream !== expected) return
    alive = false
    o.setNotice({ kind: "exited", code: p.code ?? null })
    o.onExit(p.code ?? null)
  })

  const attach = async (): Promise<void> => {
    held = []
    stream = null
    try {
      const res = await client.request<{ stream: string; alive: boolean; replay: string }>("term.attach", {
        taskId,
        tabId,
        ...(o.leafId && o.leafId !== "leaf-1" ? { leafId: o.leafId } : {}),
        cols: term.cols,
        rows: term.rows,
      })
      const current = owned.get(expected)
      if (current) current.attached = true
      else detach()
      if (disposed) return
      term.reset()
      term.write(decode(res.replay))
      for (const bytes of held) term.write(bytes)
      stream = res.stream
      alive = res.alive
      if (res.alive && document.activeElement === term.textarea) activeStream.set(res.stream)
      o.setNotice(res.alive ? { kind: "none" } : { kind: "restored" })
    } catch (err) {
      if (disposed) return
      if (err instanceof BridgeRequestError && err.code === "TAB_NOT_LIVE") o.setNotice({ kind: "notLive" })
      else if (!(err instanceof BridgeRequestError && err.code === "NOT_CONNECTED")) {
        o.setNotice({ kind: "failed", message: err instanceof Error ? err.message : String(err) })
      }
    } finally {
      held = null
    }
  }
  const offOpen = client.onOpen(() => void attach())

  const input = term.onData((data) => {
    if (stream && alive) void client.request("term.input", { stream, data }).catch(() => {})
  })
  let resizeTimer: number | null = null
  const resize = term.onResize(({ cols, rows }) => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      if (stream && alive) void client.request("term.resize", { stream, cols, rows }).catch(() => {})
    }, 80)
  })
  // Hidden behind a preview the box is 0×0; fitting to it would shrink the shared PTY.
  const observer = new ResizeObserver(() => {
    if (el.clientWidth > 0 && el.clientHeight > 0) fit.fit()
  })
  observer.observe(el)
  // The theme follows Settings live; scrollback is read when the terminal opens, as the TUI's.
  const offTheme = terminalTheme.subscribe(() => {
    term.options.theme = terminalTheme.get() ?? XTERM_THEME
  })

  // Copy: ctrl+c with a selection copies and drops it, otherwise it stays the interrupt (TUI `copySelectionIfAny`).
  term.attachCustomKeyEventHandler((e) => {
    const chord = isCopyChord(e)
    if (!chord) return true
    const text = term.getSelection()
    if (text.trim().length === 0) return chord === "interrupt-or-copy"
    void o.copyText(text)
    term.clearSelection()
    return false
  })

  // Copy-on-release: success is silent, a failure toasts (the caller's `copyText`). The selection stays lit.
  let dragging = false
  const onDown = (e: MouseEvent) => {
    dragging = e.button === 0
  }
  const onUp = () => {
    if (!dragging) return
    dragging = false
    const text = term.getSelection()
    if (text.trim().length > 0) void o.copyText(text)
  }
  el.addEventListener("mousedown", onDown)
  document.addEventListener("mouseup", onUp)

  const reportScroll = () => {
    const buffer = term.buffer.active
    o.onScrolled(Math.max(0, buffer.baseY - buffer.viewportY))
  }
  const scroll = term.onScroll(reportScroll)
  const written = term.onWriteParsed(reportScroll)

  const textarea = term.textarea
  const focused = () => {
    activeStream.set(stream)
    o.onFocusChange(true)
  }
  const blurred = () => o.onFocusChange(false)
  textarea?.addEventListener("focus", focused)
  textarea?.addEventListener("blur", blurred)

  return {
    term,
    search,
    stream: expected,
    reattach: attach,
    dispose() {
      disposed = true
      observer.disconnect()
      offTheme()
      if (resizeTimer !== null) window.clearTimeout(resizeTimer)
      el.removeEventListener("mousedown", onDown)
      document.removeEventListener("mouseup", onUp)
      textarea?.removeEventListener("focus", focused)
      textarea?.removeEventListener("blur", blurred)
      scroll.dispose()
      written.dispose()
      input.dispose()
      resize.dispose()
      offOpen()
      offData()
      offExit()
      if (stream && activeStream.get() === stream) activeStream.set(null)
      ownership.owners--
      if (ownership.owners === 0) {
        owned.delete(expected)
        if (ownership.attached) detach()
      }
      term.dispose()
    },
  }
}
