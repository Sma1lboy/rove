/**
 * One hosted PTY session in xterm.js: `term.attach` replays the host ring,
 * `term.data` streams after it, keystrokes go back as `term.input`. Live bytes
 * can overtake the attach reply on the socket, so they are held until the
 * replay is painted (the phone clients do the same). Reattaches on reconnect.
 * The xterm wiring is `term-mount.ts`; this file draws what sits over it.
 */

import { useEffect, useRef, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { ConfirmDialog } from "./dialogs.tsx"
import { t, useLocale } from "./i18n/index.ts"
import { attachableFiles, putAttachment } from "./kanban-attach.ts"
import { terminalText } from "./keymap-text.ts"
import type { AppModel } from "./model.ts"
import { beginReset, endReset, exitIsReset } from "./reset-guard.ts"
import { focusedTerm, registerTerm, termFor } from "./term-control.ts"
import { TermKeyRow } from "./term-key-row.tsx"
import { NERD_SYMBOLS_FAMILY } from "./term-look.ts"
import { type Notice, SCROLL_PAGE_LINES, type TermHandle, streamKey } from "./term-mount.ts"
import { type EngineExit, TermNotice } from "./term-notice.tsx"
import { type Leased, hasParked, leaseTerminal } from "./term-pool.ts"
import { TermSearchBar } from "./term-search.tsx"
import { dialog, toast } from "./ui.ts"

export interface TerminalViewProps {
  readonly client: BridgeClient
  readonly model: AppModel
  readonly taskId: string
  readonly tabId: string
  /** A split pane (`leaf-N`); omitted = the tab's own session. */
  readonly leafId?: string
  /** The tab's engine ended inside a still-running shell: the strip offers the way forward. */
  readonly engineExit?: EngineExit | null
  /** Take keyboard focus now (a new split, F3); the first mount of a tab takes it too. */
  readonly focused?: boolean
  /** The terminal took focus: the owner of the split marks this pane active. */
  readonly onActivate?: () => void
  /** The pane's process ended. */
  readonly onExit?: () => void
}

/** A dropped image or PDF is stored on the Mac (`attachment.put`) and its path typed into the terminal, as a terminal emulator pastes a dropped file's path. */
async function dropFiles(client: BridgeClient, handle: TermHandle, files: File[]): Promise<void> {
  const ok = attachableFiles(files)
  if (ok.length < files.length) toast(t("layout.dropUnsupported"), "error")
  for (const file of ok) {
    try {
      handle.term.paste(`${await putAttachment(client, file)} `)
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error")
    }
  }
  handle.term.focus()
}

/** The images and PDFs on the browser's clipboard; throws when the page may not read it (plain http, permission refused). */
async function clipboardFiles(): Promise<File[]> {
  if (!navigator.clipboard?.read) throw new Error(t("layout.pasteNeedsHttps"))
  const files: File[] = []
  for (const item of await navigator.clipboard.read()) {
    for (const type of item.types) {
      if (type.startsWith("image/") || type === "application/pdf") {
        files.push(new File([await item.getType(type)], "clipboard", { type }))
      }
    }
  }
  return attachableFiles(files)
}

/**
 * Never the engine's own clipboard read: it reads the rove machine's clipboard, which is not this browser's
 * from anywhere else (a tunnel to localhost included), and is the same clipboard on that machine.
 */
async function pasteClipboardImage(client: BridgeClient, handle: TermHandle): Promise<void> {
  let files: File[]
  try {
    files = await clipboardFiles()
  } catch (err) {
    toast(t("layout.pasteNoAccess", { error: err instanceof Error ? err.message : String(err) }), "error")
    return
  }
  if (files.length === 0) toast(t("layout.pasteNoImage"), "error")
  else await dropFiles(client, handle, files)
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    toast(t("menu.copyFailed"), "error")
    return false
  }
}

export function TerminalView(props: TerminalViewProps) {
  const { client, taskId, tabId, leafId } = props
  useLocale()
  const host = useRef<HTMLDivElement>(null)
  const [notice, setNotice] = useState<Notice>({ kind: "none" })
  const [handle, setHandle] = useState<TermHandle | null>(null)
  const [scrolled, setScrolled] = useState(0)
  const [searching, setSearching] = useState(false)
  const [revive, setRevive] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  // Callbacks change every render; the mount (which runs once per session) reads the latest.
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const el = host.current
    if (!el) return
    let leased: Leased | null = null
    let cancelled = false
    // The WebGL glyph atlas is cut from the font resolved when the renderer loads: before JetBrains
    // Mono arrives it paints nothing. The 1.2 MB symbols face is not awaited; term-mount redraws when it lands.
    const fonts = [document.fonts.load('13px "JetBrains Mono"'), document.fonts.load('bold 13px "JetBrains Mono"')]
    // Canvas text never asks for a unicode-range face, so start it here: a powerline glyph, not a space.
    void document.fonts.load(`13px "${NERD_SYMBOLS_FAMILY}"`, String.fromCodePoint(0xe0a0)).catch(() => {})
    const mount = () => {
      if (cancelled) return
      leased = leaseTerminal(
        { client, host: el, taskId, tabId, leafId, focusOnMount: latest.current.focused !== false },
        {
          setNotice,
          onScrolled: setScrolled,
          onFocusChange: (focused) => {
            if (!leased) return
            const { stream } = leased.handle
            if (focused) {
              latest.current.onActivate?.()
              focusedTerm.set(termFor(stream) ?? null)
            } else if (focusedTerm.get()?.stream === stream) focusedTerm.set(null)
          },
          onExit: () => {
            if (!exitIsReset(streamKey(taskId, tabId, leafId))) latest.current.onExit?.()
          },
          copyText,
          pasteImage: async () => {
            if (leased) await pasteClipboardImage(client, leased.handle)
          },
        },
      )
      setHandle(leased.handle)
    }
    // A parked terminal already has its fonts and atlas: show it in this frame.
    if (hasParked(client, taskId, tabId, leafId)) mount()
    else void Promise.allSettled(fonts).then(mount)
    return () => {
      cancelled = true
      setHandle(null)
      setSearching(false)
      leased?.release()
    }
  }, [client, taskId, tabId, leafId])

  // The control other parts of the page drive: palette, F1 keys, split commands.
  useEffect(() => {
    if (!handle) return
    const { term, stream } = handle
    const control = {
      stream,
      focus: () => term.focus(),
      scrollPages: (direction: 1 | -1) => handle.scrollLines(direction * SCROLL_PAGE_LINES),
      hasSelection: () => term.hasSelection(),
      copySelection: () => {
        const text = term.getSelection()
        if (text.trim().length === 0) return false
        void copyText(text)
        term.clearSelection()
        return true
      },
      openSearch: () => setSearching(true),
      reset: () => {
        // Snapshot at the keypress: a tab switch while the confirm is open must not reset the wrong shell.
        const size = { cols: term.cols, rows: term.rows }
        dialog.set(
          <ConfirmDialog
            title={terminalText("reset.title")}
            body={terminalText("reset.body")}
            confirmLabel={t("workspace.reset")}
            onConfirm={async () => {
              beginReset(stream)
              try {
                await client.request("tab.split", {
                  taskId,
                  tabId,
                  action: "reset",
                  leafId: leafId ?? "leaf-1",
                  ...size,
                })
                await handle.reattach()
                term.focus()
              } finally {
                endReset(stream)
              }
            }}
          />,
        )
      },
      size: () => ({ cols: term.cols, rows: term.rows }),
    }
    const off = registerTerm(control)
    if (document.activeElement === term.textarea) focusedTerm.set(control)
    return () => {
      off()
    }
  }, [handle, client, taskId, tabId, leafId])

  // An owner that moves focus to this pane (F3, a new split) lands the keyboard here.
  useEffect(() => {
    if (props.focused && handle && document.activeElement !== handle.term.textarea) handle.term.focus()
  }, [props.focused, handle])

  // Only the tab's own session reopens: a split pane has no row of its own to relaunch from.
  const ownSession = !leafId || leafId === "leaf-1"
  // The exit a successful retry answered stays hidden until the daemon marks a new one.
  const [answered, setAnswered] = useState<number | null>(null)
  const answeredExit = props.engineExit?.since === answered
  const reopening = useRef(false)
  const reopen = async (mounted: TermHandle, restartExited: boolean): Promise<void> => {
    // A second click before the first settles would run two reattaches over one stream.
    if (reopening.current) return
    reopening.current = true
    setRevive({ busy: true, error: null })
    try {
      await client.request("term.revive", { taskId, tabId, ...(restartExited ? { restartExited } : {}) })
      await mounted.reattach()
      mounted.term.focus()
      setAnswered(props.engineExit?.since ?? null)
      setRevive({ busy: false, error: null })
    } catch (err) {
      setRevive({ busy: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      reopening.current = false
    }
  }

  return (
    <div
      className="term-pane"
      data-stream={streamKey(taskId, tabId, leafId)}
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length || !handle) return
        e.preventDefault()
        void dropFiles(client, handle, Array.from(e.dataTransfer.files))
      }}
      // A pasted image goes the way of a dropped one; xterm only pastes text, so it never sees it.
      // An empty text paste would reach the engine as an empty bracketed paste, which makes it read the
      // rove machine's clipboard: read the browser's instead.
      onPasteCapture={(e) => {
        if (!handle) return
        const files = attachableFiles(e.clipboardData.files)
        if (files.length === 0 && e.clipboardData.getData("text/plain") !== "") return
        e.preventDefault()
        e.stopPropagation()
        void (files.length > 0 ? dropFiles(client, handle, files) : pasteClipboardImage(client, handle))
      }}
    >
      <div className="term-host" ref={host} />
      <TermNotice
        notice={notice}
        engineExit={answeredExit ? null : (props.engineExit ?? null)}
        model={props.model}
        taskId={taskId}
        revive={revive}
        onReopen={ownSession && handle ? (restartExited) => void reopen(handle, restartExited) : undefined}
        onRetryAttach={handle ? () => void handle.reattach() : undefined}
      />
      {scrolled > 0 && !searching && handle && (
        <div className="term-scrolled mono">
          <span className="tone-warning">{terminalText("scrolledBack", { lines: scrolled })}</span>
          <button type="button" className="link tone-info" onClick={() => handle.scrollToTop()}>
            {terminalText("scrollFirst")}
          </button>
          <button type="button" className="link tone-info" onClick={() => handle.scrollToBottom()}>
            {terminalText("scrollLatest")}
          </button>
        </div>
      )}
      {searching && handle && (
        <TermSearchBar
          handle={handle}
          onClose={() => {
            setSearching(false)
            handle.term.focus()
          }}
        />
      )}
      {handle && <TermKeyRow handle={handle} />}
    </div>
  )
}
