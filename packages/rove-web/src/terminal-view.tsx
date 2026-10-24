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
import { beginReset, endReset, exitIsReset } from "./reset-guard.ts"
import { focusedTerm, registerTerm, termFor } from "./term-control.ts"
import { type Notice, SCROLL_PAGE_LINES, type TermHandle, mountTerminal, streamKey } from "./term-mount.ts"
import { TermSearchBar } from "./term-search.tsx"
import { dialog, toast } from "./ui.ts"

export interface TerminalViewProps {
  readonly client: BridgeClient
  readonly taskId: string
  readonly tabId: string
  /** A split pane (`leaf-N`); omitted = the tab's own session. */
  readonly leafId?: string
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
    let mounted: TermHandle | null = null
    let cancelled = false
    // The WebGL glyph atlas is cut from whatever font is resolved when the renderer loads;
    // before JetBrains Mono arrives that atlas paints nothing.
    void Promise.allSettled([document.fonts.load('13px "JetBrains Mono"'), document.fonts.ready]).then(() => {
      if (cancelled) return
      mounted = mountTerminal({
        client,
        el,
        taskId,
        tabId,
        leafId,
        setNotice,
        onScrolled: setScrolled,
        onFocusChange: (focused) => {
          if (!mounted) return
          if (focused) {
            latest.current.onActivate?.()
            focusedTerm.set(termFor(mounted.stream) ?? null)
          } else if (focusedTerm.get()?.stream === mounted.stream) focusedTerm.set(null)
        },
        onExit: () => {
          if (!exitIsReset(streamKey(taskId, tabId, leafId))) latest.current.onExit?.()
        },
        copyText,
        focusOnMount: latest.current.focused !== false,
      })
      setHandle(mounted)
    })
    return () => {
      cancelled = true
      setHandle(null)
      setSearching(false)
      mounted?.dispose()
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
  const canRevive =
    (notice.kind === "notLive" || notice.kind === "restored" || notice.kind === "exited") &&
    (!leafId || leafId === "leaf-1")
  const reopening = useRef(false)
  const reopen = async (mounted: TermHandle): Promise<void> => {
    // A second click before the first settles would run two reattaches over one stream.
    if (reopening.current) return
    reopening.current = true
    setRevive({ busy: true, error: null })
    try {
      await client.request("term.revive", { taskId, tabId })
      await mounted.reattach()
      mounted.term.focus()
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
      onPasteCapture={(e) => {
        if (!handle || attachableFiles(e.clipboardData.files).length === 0) return
        e.preventDefault()
        e.stopPropagation()
        void dropFiles(client, handle, attachableFiles(e.clipboardData.files))
      }}
    >
      <div className="term-host" ref={host} />
      {notice.kind !== "none" && (
        <div className={`term-notice ${notice.kind === "failed" || revive.error ? "is-error" : ""}`}>
          <span>{revive.error ? t("workspace.reopenFailed", { message: revive.error }) : noticeText(notice)}</span>
          {canRevive && handle && (
            <button type="button" className="link tone-info" disabled={revive.busy} onClick={() => void reopen(handle)}>
              {revive.busy ? t("workspace.reopening") : t("workspace.reopen")}
            </button>
          )}
        </div>
      )}
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
    </div>
  )
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
