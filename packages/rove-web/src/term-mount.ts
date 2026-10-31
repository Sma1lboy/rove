/**
 * One hosted PTY session in xterm.js: `term.attach` replays the host ring, then
 * `term.data` pushes stream live; keystrokes and resizes go back as `term.input`
 * / `term.resize`. Plain TypeScript around the xterm instance so the React view
 * only owns what it draws (notice, scroll chips, search row).
 */

import { SearchAddon } from "@xterm/addon-search"
import { SerializeAddon } from "@xterm/addon-serialize"
import { Unicode11Addon } from "@xterm/addon-unicode11"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { type BridgeClient, BridgeRequestError } from "./bridge.ts"
import { terminalTheme } from "./prefs-theme.ts"
import { prefsStore } from "./prefs.ts"
import { createCover } from "./term-cover.ts"
import { OverlayFitAddon } from "./term-fit.ts"
import { attachKittyImages } from "./term-images.ts"
import { ctrlChord } from "./term-keys.ts"
import { FONT_FAMILY, XTERM_THEME } from "./term-look.ts"
import { createReplyGate } from "./term-replies.ts"
import { linesFromBottom, viewportAfterWrite } from "./term-scroll.ts"
import { attachWheelScroll, createSmoothScroll } from "./term-smooth.ts"
import { attachTouchScroll } from "./term-touch.ts"
import { loadWebgl } from "./term-webgl.ts"
import { createAcks, decode, resetPayload, streamPayload } from "./term-wire.ts"
import { activeStream, layoutMoving } from "./ui.ts"

/** `DEFAULT_PAGE_SIZE`: lines per `ctrl+pgup` / `ctrl+pgdown`. */
export const SCROLL_PAGE_LINES = 10

/** Width of xterm's overlay scrollbar (its default is 14); it floats over the last column (`term-fit.ts`). */
const SCROLLBAR_WIDTH = 8

export type Notice =
  | { readonly kind: "none" }
  | { readonly kind: "restored" }
  | { readonly kind: "notLive" }
  | { readonly kind: "exited"; readonly code: number | null }
  | { readonly kind: "failed"; readonly message: string }

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
  /** Mac Ctrl+V: attaches the image on the browser's clipboard, or says why it can't. */
  readonly pasteImage: () => Promise<void>
  readonly focusOnMount: boolean
  /** The screen as it last looked (`TermHandle.snapshot`), shown over the terminal until the reattach repaints it. */
  readonly snapshot?: string
  /** The first replay is on screen (or the attach failed): what the view showed before can go. */
  readonly onPainted?: () => void
}

export interface TermHandle {
  readonly term: Terminal
  readonly search: SearchAddon
  readonly stream: string
  /** User scrolls (keys, the scroll chips): negative = toward older output. */
  scrollLines(lines: number): void
  scrollToTop(): void
  scrollToBottom(): void
  /** The next single key typed reaches the engine as its Ctrl chord; `onUsed` fires when it does. `null` disarms. */
  armCtrl(onUsed: (() => void) | null): void
  /** Attach again (a reset respawned the session under the same key). */
  reattach(): Promise<void>
  /** The visible screen as HTML, for a later mount of the same stream to show while it reattaches. */
  snapshot(): string
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

const RIS = new Uint8Array([0x1b, 0x63])

/** `bytes` behind a full reset, as one write: xterm parses it in a single pass, so no frame paints the cleared screen. */
function withReset(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(RIS.length + bytes.length)
  out.set(RIS)
  out.set(bytes, RIS.length)
  return out
}

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
    // xterm sizes its scrollbar from the overview ruler's width; the ruler itself is hidden in CSS.
    overviewRuler: { width: SCROLLBAR_WIDTH },
    // xterm would also jump to the bottom on mouse reports sent to the app; typing is handled below.
    scrollOnUserInput: false,
  })
  const fit = new OverlayFitAddon(term)
  const search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  const serialize = new SerializeAddon()
  term.loadAddon(serialize)
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = "11"
  term.loadAddon(new WebLinksAddon())
  term.open(el)
  const webgl = loadWebgl(term)
  const images = attachKittyImages(term)
  fit.fit()
  // A reattach replays a ring that starts mid-repaint, so the screen is blank until the engine redraws.
  const cover = createCover(term, el, serialize)
  let replayed = false
  if (o.snapshot) cover.raise(o.snapshot)
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
  let held: Array<{ bytes: Uint8Array; chars: number }> | null = null
  let disposed = false
  const replies = createReplyGate((data) => {
    if (stream && alive) void client.request("term.input", { stream, data }).catch(() => {})
  })
  const acks = createAcks((chars) => {
    if (stream) void client.request("term.ack", { stream, chars }).catch(() => {})
  })
  const writeAcked = (bytes: Uint8Array, chars: number, parsed?: () => void) => {
    images.push(bytes)
    term.write(bytes, () => {
      parsed?.()
      acks.parsed(chars)
    })
  }

  const offData = client.on("term.data", (raw) => {
    const p = streamPayload(raw)
    if (!p?.data || p.stream !== expected) return
    const bytes = decode(p.data)
    if (held) held.push({ bytes, chars: p.data.length })
    else if (stream) writeAcked(bytes, p.data.length)
  })
  // RIS and the replay are one chunk: a frame never paints between the wipe and the redraw.
  const offReset = client.on("term.reset", (raw) => {
    const p = resetPayload(raw)
    if (!p || p.stream !== expected || !stream || held) return
    replies.replay((parsed) => writeAcked(withReset(decode(p.replay)), p.replay.length, parsed))
  })
  const offExit = client.on("term.exit", (raw) => {
    const p = streamPayload(raw)
    if (!p || p.stream !== expected) return
    alive = false
    o.setNotice({ kind: "exited", code: p.code ?? null })
    o.onExit(p.code ?? null)
  })

  // Once the first replay is parsed and drawn (or the attach failed) the view can let go of what it showed before.
  let paintedOnce = false
  const painted = (drawn: boolean) => {
    if (paintedOnce) return
    paintedOnce = true
    if (drawn) requestAnimationFrame(() => requestAnimationFrame(() => o.onPainted?.()))
    else o.onPainted?.()
  }
  const attach = async (): Promise<void> => {
    held = []
    stream = null
    try {
      const res = await client.request<{ stream: string; alive: boolean; restored?: boolean; replay: string }>(
        "term.attach",
        {
          taskId,
          tabId,
          ...(o.leafId && o.leafId !== "leaf-1" ? { leafId: o.leafId } : {}),
          cols: term.cols,
          rows: term.rows,
          acks: true,
        },
      )
      const current = owned.get(expected)
      if (current) current.attached = true
      else detach()
      if (disposed) return
      smooth.reset()
      // A screen already showing this session stays up as a snapshot until the engine has repainted over the replay.
      if (replayed && !cover.raised) cover.raise(cover.snapshot())
      replayed = true
      heldBack = null
      ignoreWipe = true
      // Reset and replay go in as one chunk, so they parse in one pass and no frame paints between them: a
      // synchronous `term.reset()` with the replay queued behind it painted the empty terminal for a frame.
      replies.replay((parsed) => {
        const bytes = decode(res.replay)
        images.push(bytes)
        term.write(withReset(bytes), () => {
          ignoreWipe = false
          parsed()
          painted(true)
        })
      })
      for (const h of held) writeAcked(h.bytes, h.chars)
      stream = res.stream
      alive = res.alive
      // The ring replay of a long session starts mid-repaint, so a reattach at an unchanged size
      // draws a mostly blank screen. A one-row size nudge makes the engine repaint in full (the
      // host only SIGWINCHes on a size change).
      if (res.alive && term.rows > 2) {
        const { cols, rows } = term
        const owner = res.stream
        void client
          .request("term.resize", { stream: owner, cols, rows: rows - 1 })
          .then(() => new Promise((ok) => window.setTimeout(ok, 60)))
          .then(() =>
            stream === owner
              ? client.request("term.resize", { stream: owner, cols: term.cols, rows: term.rows })
              : undefined,
          )
          .then(() => window.setTimeout(cover.lower, 250))
          .catch(cover.lower)
      } else cover.lower()
      if (res.alive && document.activeElement === term.textarea) activeStream.set(res.stream)
      o.setNotice(res.alive ? { kind: "none" } : res.restored ? { kind: "restored" } : { kind: "exited", code: null })
    } catch (err) {
      if (disposed) return
      if (err instanceof BridgeRequestError && err.code === "TAB_NOT_LIVE") o.setNotice({ kind: "notLive" })
      else if (!(err instanceof BridgeRequestError && err.code === "NOT_CONNECTED")) {
        o.setNotice({ kind: "failed", message: err instanceof Error ? err.message : String(err) })
      }
    } finally {
      held = null
      if (!stream) {
        cover.lower()
        painted(false)
      }
    }
  }
  // An unlaid-out box (phone workspace still display:none) would attach at xterm's 80×24 default.
  const sized = () => el.clientWidth > 0 && el.clientHeight > 0
  let attachWhenSized = false
  const offOpen = client.onOpen(() => {
    attachWhenSized = !sized()
    if (!attachWhenSized) void attach()
  })

  let ctrlNext: (() => void) | null = null
  const input = term.onData((data) => {
    if (ctrlNext && data.length === 1) {
      const used = ctrlNext
      ctrlNext = null
      used()
      replies.forward(ctrlChord(data))
    } else replies.forward(data)
  })
  // Every viewer of a PTY shares one size and the last to send wins; an inline TUI drawn for another
  // viewer's width leaves ghost frames here. The viewer the person is using claims it back: on focus,
  // and on a keystroke (throttled; the host ignores a size it already has).
  let claimedAt = 0
  const claimSize = () => {
    if (!stream || !alive) return
    claimedAt = Date.now()
    void client.request("term.resize", { stream, cols: term.cols, rows: term.rows }).catch(() => {})
  }
  const keyed = term.onKey(() => {
    if (Date.now() - claimedAt > 1000) claimSize()
  })
  let resizeTimer: number | null = null
  const resize = term.onResize(({ cols, rows }) => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      if (stream && alive) void client.request("term.resize", { stream, cols, rows }).catch(() => {})
    }, 80)
  })
  // Hidden behind a preview the box is 0×0; fitting to it would shrink the shared PTY. While a column slides
  // or is dragged the canvas keeps its size: fit once it settles.
  const refit = () => {
    if (layoutMoving.get() !== null || !sized()) return
    fit.fit()
    if (attachWhenSized) {
      attachWhenSized = false
      void attach()
    }
  }
  const observer = new ResizeObserver(refit)
  observer.observe(el)
  const offMoving = layoutMoving.subscribe(refit)
  // The theme and the scrollback depth follow Settings: a terminal restored before the page's first prefs reply catches up.
  const offScroll = prefsStore.subscribe(() => {
    term.options.scrollback = prefsStore.get().prefs.scrollbackRows
  })
  // The host shows through below the last whole row: paint it the terminal's own background.
  const paintHost = () => {
    el.style.backgroundColor = (terminalTheme.get() ?? XTERM_THEME).background ?? ""
  }
  paintHost()
  const offTheme = terminalTheme.subscribe(() => {
    term.options.theme = terminalTheme.get() ?? XTERM_THEME
    paintHost()
  })

  // Copy: ctrl+c with a selection copies and drops it, otherwise it stays the interrupt (TUI `copySelectionIfAny`).
  term.attachCustomKeyEventHandler((e) => {
    // On a Mac, Ctrl+V would ask the engine to read the rove machine's clipboard, not this browser's.
    // Elsewhere it is the browser's own paste, which the paste event already covers.
    const ctrlV =
      e.type === "keydown" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "v"
    if (ctrlV && /Mac|iPhone|iPad/.test(navigator.platform)) {
      void o.pasteImage()
      return false
    }
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

  // Scrolling as the TUI pane does it. A wheel the app does not take moves the scrollback by whole
  // lines here, not through xterm's scrollable, which drops a sub-line touchpad delta whenever new
  // output lands before it adds up to a row; the fraction of a line left over shifts the screen by
  // CSS (`term-smooth.ts`) so the text follows the fingers every frame. A view at the bottom follows
  // output; a scrolled one stays put, and if the app wipes the scrollback under it (ESC[3J, ESC c: a
  // full repaint) it keeps its distance from the bottom while the wipes go on. Typing returns to the
  // bottom.
  const textarea = term.textarea
  let heldBack: number | null = null
  // The wipe a reattach's own reset makes is not the app's: the view goes to the bottom, as it always did.
  let ignoreWipe = false
  let lastWipe = 0
  const smooth = createSmoothScroll(term, () => {
    heldBack = null
  })
  const detachWheel = attachWheelScroll(el, term, smooth)
  const detachTouch = attachTouchScroll(el, term, smooth)
  const onScrollbarDown = (e: MouseEvent) => {
    if (!(e.target instanceof Element && e.target.closest(".scrollbar"))) return
    heldBack = null
    smooth.reset()
  }
  el.addEventListener("mousedown", onScrollbarDown, { capture: true })
  const noteWipe = () => {
    if (!ignoreWipe && term.buffer.active.type === "normal") {
      const back = linesFromBottom(term.buffer.active)
      if (heldBack === null && back > 0) heldBack = back
      lastWipe = performance.now()
    }
    return false
  }
  const wipeScrollback = term.parser.registerCsiHandler({ final: "J" }, (params) =>
    params[0] === 3 ? noteWipe() : false,
  )
  const wipeAll = term.parser.registerEscHandler({ final: "c" }, noteWipe)
  const followInput = () => {
    heldBack = null
    smooth.reset()
    if (linesFromBottom(term.buffer.active) > 0) term.scrollToBottom()
  }
  const typed = term.onKey(followInput)
  textarea?.addEventListener("paste", followInput)
  textarea?.addEventListener("compositionend", followInput)

  const reportScroll = () => o.onScrolled(linesFromBottom(term.buffer.active))
  const scroll = term.onScroll(reportScroll)
  const written = term.onWriteParsed(() => {
    // A second without a wipe: plain output again, which xterm already holds against.
    if (heldBack !== null && performance.now() - lastWipe > 1000) heldBack = null
    const target = viewportAfterWrite(heldBack, term.buffer.active)
    if (target !== null) term.scrollToLine(target)
    reportScroll()
  })
  const userScroll = (move: () => void) => {
    heldBack = null
    smooth.reset()
    move()
  }

  const focused = () => {
    activeStream.set(stream)
    claimSize()
    o.onFocusChange(true)
  }
  const blurred = () => o.onFocusChange(false)
  textarea?.addEventListener("focus", focused)
  textarea?.addEventListener("blur", blurred)

  return {
    term,
    search,
    stream: expected,
    scrollLines: (lines) => userScroll(() => term.scrollLines(lines)),
    scrollToTop: () => userScroll(() => term.scrollToTop()),
    scrollToBottom: () => userScroll(() => term.scrollToBottom()),
    armCtrl: (onUsed) => {
      ctrlNext = onUsed
    },
    reattach: attach,
    snapshot: cover.snapshot,
    dispose() {
      disposed = true
      cover.lower()
      observer.disconnect()
      detachWheel()
      detachTouch()
      smooth.dispose()
      el.removeEventListener("mousedown", onScrollbarDown, { capture: true })
      textarea?.removeEventListener("paste", followInput)
      textarea?.removeEventListener("compositionend", followInput)
      wipeScrollback.dispose()
      wipeAll.dispose()
      typed.dispose()
      offTheme()
      offScroll()
      offMoving()
      if (resizeTimer !== null) window.clearTimeout(resizeTimer)
      el.removeEventListener("mousedown", onDown)
      document.removeEventListener("mouseup", onUp)
      textarea?.removeEventListener("focus", focused)
      textarea?.removeEventListener("blur", blurred)
      scroll.dispose()
      written.dispose()
      input.dispose()
      keyed.dispose()
      resize.dispose()
      offOpen()
      offData()
      offExit()
      offReset()
      acks.dispose()
      if (stream && activeStream.get() === stream) activeStream.set(null)
      ownership.owners--
      if (ownership.owners === 0) {
        owned.delete(expected)
        if (ownership.attached) detach()
      }
      images.dispose()
      term.dispose()
      webgl.dispose()
    },
  }
}
