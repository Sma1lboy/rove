import { useEffect, useRef, useState } from "react"
import { macHost, onMacEvent } from "./mac-host.ts"
import { terminalTheme } from "./prefs-theme.ts"
import { prefsStore } from "./prefs.ts"
import { exitIsReset } from "./reset-guard.ts"
import { type Notice, streamKey } from "./term-contract.ts"
import { focusedTerm, registerTerm } from "./term-control.ts"
import { XTERM_THEME } from "./term-look.ts"
import { TermNotice } from "./term-notice.tsx"
import { createReplyGate } from "./term-replies.ts"
import { createAcks, resetPayload, streamPayload } from "./term-wire.ts"
import { confirmTerminalReset } from "./terminal-reset.tsx"
import type { TerminalViewProps } from "./terminal-view.tsx"
import { TERM_BODY, TERM_HOST, TERM_PANE } from "./ui/shell.ts"

/** Native views sit above WebKit. Menus and dialogs must retain their mouse and keyboard targets. */
function trackFrame(el: HTMLElement, send: (rect: DOMRect, visible: boolean) => void) {
  let last = ""
  let frame = 0
  const update = () => {
    frame = 0
    const r = el.getBoundingClientRect()
    const visible =
      r.width > 1 &&
      r.height > 1 &&
      [
        [0.02, 0.03],
        [0.5, 0.5],
        [0.98, 0.97],
        [0.02, 0.97],
        [0.98, 0.03],
      ].every(([x, y]) => el.contains(document.elementFromPoint(r.x + r.width * x!, r.y + r.height * y!))) &&
      !document.querySelector('[role="menu"], [aria-modal="true"], .overlay')
    const key = [r.x, r.y, r.width, r.height, visible].join(",")
    if (key !== last) {
      last = key
      send(r, visible)
    }
  }
  const check = () => {
    if (document.hidden) update()
    else if (!frame) frame = requestAnimationFrame(update)
  }
  const resize = new ResizeObserver(check)
  resize.observe(el)
  const changes = new MutationObserver(check)
  changes.observe(document.body, { childList: true, attributes: true, subtree: true })
  window.addEventListener("resize", check)
  window.addEventListener("scroll", check, true)
  document.addEventListener("transitionend", check)
  document.addEventListener("visibilitychange", check)
  update()
  return () => {
    resize.disconnect()
    changes.disconnect()
    cancelAnimationFrame(frame)
    window.removeEventListener("resize", check)
    window.removeEventListener("scroll", check, true)
    document.removeEventListener("transitionend", check)
    document.removeEventListener("visibilitychange", check)
  }
}

export function MacTerminal(props: TerminalViewProps) {
  const { client, taskId, tabId, leafId } = props
  const host = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const [notice, setNotice] = useState<Notice>({ kind: "none" })
  const [attempt, retry] = useState(0)
  const [reopening, setReopening] = useState(false)
  const expected = streamKey(taskId, tabId, leafId)
  useEffect(() => {
    if (!host.current || !macHost) return
    const el = host.current
    const id = String(attempt) + crypto.randomUUID()
    const post = (op: string, detail = {}) => macHost?.postMessage({ id, op, ...detail })
    const request = (name: string, args: Record<string, unknown>) => void client.request(name, args).catch(() => {})
    let open = false
    let generation = 0
    let live = false
    let cols = 0
    let rows = 0
    let held: string[] | null = null
    const acks = createAcks((chars) => {
      if (live) request("term.ack", { stream: expected, chars })
    })
    const attach = async () => {
      if (!open || !cols || !rows) return
      const size = { cols, rows }
      const n = ++generation
      live = false
      held = []
      try {
        const r = await client.request<{ alive: boolean; restored?: boolean; replay: string }>("term.attach", {
          taskId,
          tabId,
          ...(leafId && leafId !== "leaf-1" ? { leafId } : {}),
          ...size,
          acks: true,
        })
        if (generation !== n) return
        live = r.alive
        if (live && (cols !== size.cols || rows !== size.rows)) request("term.resize", { stream: expected, cols, rows })
        post("replay", { data: r.replay })
        for (const data of held ?? []) post("data", { data })
        held = null
        setNotice(r.alive ? { kind: "none" } : { kind: r.restored ? "restored" : "notLive" })
      } catch (err) {
        if (generation === n) {
          held = null
          setNotice({ kind: "failed", message: String(err) })
        }
      }
    }
    let selected = false
    const input = (data: string) => {
      if (live) request("term.input", { stream: expected, data })
    }
    const replies = createReplyGate(input)
    const control = {
      stream: expected,
      input,
      focus: () => post("focus"),
      size: () => ({ cols, rows }),
      reattach: attach,
      scrollPages: (direction: 1 | -1) => post("scroll", { direction }),
      hasSelection: () => selected,
      copySelection: () => {
        if (selected) post("copy")
        return selected
      },
      reset: () =>
        confirmTerminalReset(client, taskId, tabId, leafId, { cols, rows }, async () => {
          await attach()
          post("focus")
        }),
    }
    const unregister = registerTerm(control)
    const offNative = onMacEvent((e) => {
      if (e.id !== id) return
      if (e.action === "input" && e.data) input(e.data)
      if (e.action === "reply" && e.data) replies.forward(e.data)
      if (e.action === "selection") selected = e.selected === true
      if (e.action === "blur" && focusedTerm.get() === control) focusedTerm.set(null)
      if (e.action === "parsed" && e.chars) acks.parsed(e.chars)
      if (e.action === "focus") {
        focusedTerm.set(control)
        latest.current.onActivate?.()
      }
      if (e.action === "size" && e.cols && e.rows) {
        const first = !cols
        cols = e.cols
        rows = e.rows
        if (first) void attach()
        else if (live) request("term.resize", { stream: expected, cols, rows })
      }
    })
    const off = [
      client.on("term.data", (raw) => {
        const p = streamPayload(raw)
        if (p?.stream !== expected || !p.data) return
        if (held) held.push(p.data)
        else if (live) post("data", { data: p.data })
      }),
      client.on("term.reset", (raw) => {
        const p = resetPayload(raw)
        if (live && p?.stream === expected) post("reset", { data: p.replay })
      }),
      client.on("term.exit", (raw) => {
        const p = streamPayload(raw)
        if (p?.stream !== expected) return
        live = false
        ++generation
        held = null
        setNotice({ kind: "exited", code: p.code ?? null })
        if (!exitIsReset(expected)) latest.current.onExit?.()
      }),
      client.conn.subscribe(() => {
        if (client.conn.get().state !== "open") {
          open = false
          live = false
          held = null
          ++generation
        }
      }),
      client.onOpen(() => {
        open = true
        void attach()
      }),
    ]
    const appearance = () => {
      const theme = terminalTheme.get() ?? XTERM_THEME
      return {
        dark: getComputedStyle(document.documentElement).colorScheme !== "light",
        foreground: theme.foreground,
        background: theme.background,
        scrollback: prefsStore.get().prefs.scrollbackRows,
      }
    }
    const refreshAppearance = () => post("appearance", appearance())
    off.push(terminalTheme.subscribe(refreshAppearance), prefsStore.subscribe(refreshAppearance))
    const untrack = trackFrame(el, (r, visible) =>
      post("frame", {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        visible,
        focus: latest.current.focused !== false,
        ...appearance(),
      }),
    )
    return () => {
      ++generation
      live = false
      for (const stop of off) stop()
      unregister()
      offNative()
      acks.dispose()
      untrack()
      post("remove")
      if (open && cols) request("term.detach", { stream: expected })
      open = false
    }
  }, [client, taskId, tabId, leafId, expected, attempt])
  const reopen = async (restartExited: boolean) => {
    setReopening(true)
    try {
      await client.request("term.revive", { taskId, tabId, ...(restartExited ? { restartExited } : {}) })
      retry((n) => n + 1)
    } catch (e) {
      setNotice({ kind: "failed", message: String(e) })
    } finally {
      setReopening(false)
    }
  }
  return (
    <div className={TERM_PANE} data-stream={expected}>
      <div className={TERM_BODY}>
        <div className={TERM_HOST} ref={host} data-native-terminal="" />
        <TermNotice
          model={props.model}
          taskId={taskId}
          tabId={tabId}
          notice={notice}
          engineExit={props.engineExit ?? null}
          revive={{ busy: reopening, error: null }}
          onRetryAttach={() => retry((n) => n + 1)}
          onReopen={reopen}
        />
      </div>
    </div>
  )
}
