/**
 * One hosted PTY session in xterm.js: `term.attach` replays the host ring,
 * `term.data` streams after it, keystrokes go back as `term.input`. Live bytes
 * can overtake the attach reply on the socket, so they are held until the
 * replay is painted (the phone clients do the same). Reattaches on reconnect.
 */

import { FitAddon } from "@xterm/addon-fit"
import { Unicode11Addon } from "@xterm/addon-unicode11"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { useEffect, useRef, useState } from "react"
import { type BridgeClient, BridgeRequestError } from "./bridge.ts"
import { t, useLocale } from "./i18n/index.ts"
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

type Notice =
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

export function TerminalView({ client, taskId, tabId }: { client: BridgeClient; taskId: string; tabId: string }) {
  useLocale()
  const host = useRef<HTMLDivElement>(null)
  const [notice, setNotice] = useState<Notice>({ kind: "none" })

  useEffect(() => {
    const el = host.current
    if (!el) return
    let teardown: (() => void) | null = null
    let cancelled = false
    // The WebGL glyph atlas is cut from whatever font is resolved when the renderer loads;
    // before JetBrains Mono arrives that atlas paints nothing.
    void Promise.allSettled([document.fonts.load('13px "JetBrains Mono"'), document.fonts.ready]).then(() => {
      if (!cancelled) teardown = mountTerminal(el, client, taskId, tabId, setNotice)
    })
    return () => {
      cancelled = true
      teardown?.()
    }
  }, [client, taskId, tabId])

  return (
    <div className="term-pane">
      <div className="term-host" ref={host} />
      {notice.kind !== "none" && (
        <div className={`term-notice ${notice.kind === "failed" ? "is-error" : ""}`}>{noticeText(notice)}</div>
      )}
    </div>
  )
}

// Attachments are shared by stream within a connection, including pending replies.
const attachments = new WeakMap<BridgeClient, Map<string, { owners: number; attached: boolean }>>()

/** Opens xterm in `el` and wires it to one hosted session; returns its teardown. */
export function mountTerminal(
  el: HTMLElement,
  client: BridgeClient,
  taskId: string,
  tabId: string,
  setNotice: (notice: Notice) => void,
): () => void {
  const term = new Terminal({
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    lineHeight: 1.15,
    theme: XTERM_THEME,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: true,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
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
  term.focus()

  const expected = `${taskId}::${tabId}`
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
    setNotice({ kind: "exited", code: p.code ?? null })
  })

  const attach = async (): Promise<void> => {
    held = []
    stream = null
    try {
      const res = await client.request<{ stream: string; alive: boolean; replay: string }>("term.attach", {
        taskId,
        tabId,
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
      if (res.alive) activeStream.set(res.stream)
      setNotice(res.alive ? { kind: "none" } : { kind: "restored" })
    } catch (err) {
      if (disposed) return
      if (err instanceof BridgeRequestError && err.code === "TAB_NOT_LIVE") setNotice({ kind: "notLive" })
      else if (!(err instanceof BridgeRequestError && err.code === "NOT_CONNECTED")) {
        setNotice({ kind: "failed", message: err instanceof Error ? err.message : String(err) })
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

  return () => {
    disposed = true
    observer.disconnect()
    if (resizeTimer !== null) window.clearTimeout(resizeTimer)
    input.dispose()
    resize.dispose()
    offOpen()
    offData()
    offExit()
    ownership.owners--
    if (ownership.owners === 0) {
      owned.delete(expected)
      if (ownership.attached) detach()
    }
    if (stream && activeStream.get() === stream) activeStream.set(null)
    term.dispose()
  }
}

function noticeText(notice: Notice): string {
  switch (notice.kind) {
    case "restored":
      return t("workspace.restored")
    case "notLive":
      return t("workspace.tabNotLive")
    case "exited":
      return t("workspace.exited", { code: notice.code ?? "?" })
    case "failed":
      return t("workspace.attachFailed", { message: notice.message })
    case "none":
      return ""
  }
}
