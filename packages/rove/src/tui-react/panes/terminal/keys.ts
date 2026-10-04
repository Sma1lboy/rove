/**
 * Terminal pane key bindings (React registration). When focused, every key
 * the shell expects is forwarded verbatim; the command prefix,
 * `RESERVED_GLOBAL_CHORDS`, and ctrl+pgup/pgdown stay kobe-owned (rationale
 * in `keys-pure.ts`).
 */

import { type KeyEvent, decodePasteBytes } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { useEffect, useMemo } from "react"
import { asAttachmentPaths } from "../../../tui/lib/attachments"
import {
  COPY_CHORDS,
  DEFAULT_PAGE_SIZE,
  NORMAL_TERMINAL_INPUT_MODES,
  PASSTHROUGH_CHORDS,
  keyEventToShellBytes,
} from "../../../tui/panes/terminal/keys-pure"
import type { TerminalInputModes } from "../../../tui/panes/terminal/keys-pure"
import { bindByIds } from "../../context/keybindings"
import { type Binding, modalActive, useBindings } from "../../lib/keymap"
import { useLatest } from "../../lib/use-latest"

export type TerminalBindingsOpts = {
  focused: boolean
  /** Whether this caller explicitly owns image/PDF path pastes while unfocused. */
  unfocusedAttachmentTarget: boolean
  write: (data: string) => void
  /** Read the child PTY's current cursor/keypad application modes. */
  inputModes?: () => TerminalInputModes
  /** Deliver pasted text (backend applies bracketed-paste wrapping). */
  paste: (text: string) => void
  /** Scroll the local scrollback view by N lines (negative = up). */
  scroll: (lines: number) => void
  /** How many lines `ctrl+pgup`/`ctrl+pgdown` move per press. Defaults to `DEFAULT_PAGE_SIZE`. */
  pageSize?: number
  /** Tear down the current PTY and spawn a fresh shell at the same worktree (F5, confirm-gated). */
  reset: () => void
  /** Copy + clear the selection; false (none) lets ctrl+c stay an interrupt. */
  copySelection: () => boolean
  /** Search row open: all passthrough AND the raw catch-all switch off, since
   *  the query's raw listener runs after them and would lose the keystroke. */
  searchActive: boolean
  /** Open the scrollback search row (prefix `/`). */
  openSearch: () => void
  /** Walk to the next (+1) / previous (-1) hit. */
  stepSearch: (delta: 1 | -1) => void
  /** Close the search row and restore the viewport it opened on. */
  closeSearch: () => void
}

/** Register the terminal pane's pane-local bindings. */
export function useTerminalBindings(opts: TerminalBindingsOpts): void {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE
  const optsRef = useLatest(opts)
  const pageSizeRef = useLatest(pageSize)

  // Built once per mount: the pane re-renders per output frame and the
  // ~850-entry table never changes. Handlers read live opts via ref.
  const bindings = useMemo(() => {
    const table: Binding[] = []
    // FIRST, to beat the passthrough `pageup`/`pagedown` variants.
    table.push(
      ...bindByIds({
        "terminal.scroll-up": () => optsRef.current.scroll(-pageSizeRef.current),
        "terminal.scroll-down": () => optsRef.current.scroll(pageSizeRef.current),
        "terminal.reset": () => optsRef.current.reset(),
        "terminal.search": () => optsRef.current.openSearch(),
      }),
    )
    // BEFORE the table, to beat its `ctrl+shift+c`. `cmd+c` has no table
    // entry, but the raw catch-all would encode it; this stops it.
    for (const chord of COPY_CHORDS) {
      table.push({
        key: chord,
        cmd: () => {
          optsRef.current.copySelection()
        },
      })
    }
    const forward = (evt: KeyEvent): void => {
      const bytes = keyEventToShellBytes(evt, optsRef.current.inputModes?.() ?? NORMAL_TERMINAL_INPUT_MODES)
      if (bytes != null) optsRef.current.write(bytes)
    }
    for (const chord of PASSTHROUGH_CHORDS) table.push({ key: chord, cmd: forward, passthrough: true })
    return table
  }, [])

  useBindings(() => ({
    enabled: optsRef.current.focused && !optsRef.current.searchActive,
    bindings,
  }))

  // Separate so it survives the gate above; `up`/`down` reach it because passthrough is off.
  const searchBindings = useMemo(
    () =>
      bindByIds({
        "terminal.search.older": () => optsRef.current.stepSearch(-1),
        "terminal.search.newer": () => optsRef.current.stepSearch(1),
        "terminal.search.cancel": () => optsRef.current.closeSearch(),
      }),
    [],
  )
  useBindings(() => ({
    enabled: optsRef.current.focused && optsRef.current.searchActive,
    bindings: searchBindings,
  }))

  // Catch-all forwarder for IME commits and names outside `PASSTHROUGH_NAMES`.
  // Registered ONCE; reads `opts` via ref.
  const renderer = useRenderer()
  useEffect(() => {
    if (!renderer) return
    // Pane focus doesn't change when a dialog opens; raw listeners must gate
    // themselves or dialog typing lands in the PTY.
    const forwardUnhandled = (evt: KeyEvent) => {
      if (!optsRef.current.focused || optsRef.current.searchActive) return
      if (evt.defaultPrevented || modalActive()) return
      const bytes = keyEventToShellBytes(evt, optsRef.current.inputModes?.() ?? NORMAL_TERMINAL_INPUT_MODES)
      if (bytes == null) return
      optsRef.current.write(bytes)
      evt.preventDefault()
    }
    const forwardPaste = (evt: { bytes: Uint8Array; defaultPrevented: boolean; preventDefault(): void }) => {
      if (evt.defaultPrevented || modalActive() || optsRef.current.searchActive) return
      const text = decodePasteBytes(evt.bytes)
      if (text.length === 0) return
      if (!optsRef.current.focused && (!optsRef.current.unfocusedAttachmentTarget || !asAttachmentPaths(text))) return
      optsRef.current.paste(text)
      evt.preventDefault()
    }
    renderer.keyInput.on("keypress", forwardUnhandled)
    renderer.keyInput.on("paste", forwardPaste)
    return () => {
      renderer.keyInput.off("keypress", forwardUnhandled)
      renderer.keyInput.off("paste", forwardPaste)
    }
  }, [renderer])
}
