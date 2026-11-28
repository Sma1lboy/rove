/** A touch screen's key row under the terminal: esc, ⇧tab, ^C, up, down and Enter, then `⋯` for a sticky Ctrl, tab, left and right; at a menu, 1–4 first. */

import { useEffect, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import type { TermHandle } from "./term-contract.ts"
import { type TermKey, keyPages } from "./term-keys.ts"
import { TERM_KEY_ROW, termKey } from "./ui/shell.ts"

/** Keys whose cap is a symbol a screen reader can't say. */
const KEY_NAMES: Readonly<Record<string, string>> = {
  up: "layout.termKeyUp",
  down: "layout.termKeyDown",
  left: "layout.termKeyLeft",
  right: "layout.termKeyRight",
  interrupt: "layout.termKeyInterrupt",
  enter: "layout.termKeyEnter",
}

/**
 * `to`: the terminal on screen, or the PTY's raw input when no terminal is (the phone's Chat view). Without
 * a terminal there is nothing to type the sticky Ctrl's next key into, so the row has no Ctrl, and arrows
 * go as plain cursor keys.
 */
export function TermKeyRow({ to, atMenu }: { to: TermHandle | ((data: string) => void); atMenu: boolean }) {
  useLocale()
  const handle = typeof to === "function" ? null : to
  const [ctrl, setCtrl] = useState(false)
  const [more, setMore] = useState(false)
  useEffect(() => {
    handle?.armCtrl(ctrl ? () => setCtrl(false) : null)
  }, [handle, ctrl])
  useEffect(() => () => handle?.armCtrl(null), [handle])
  const send = (k: TermKey) =>
    typeof to === "function"
      ? to(k.bytes(false))
      : to.term.input(k.bytes(to.term.modes.applicationCursorKeysMode), true)
  const key = (k: TermKey) => (
    <button
      key={k.id}
      type="button"
      className={termKey("off")}
      aria-label={KEY_NAMES[k.id] ? t(KEY_NAMES[k.id]) : undefined}
      onClick={() => {
        setCtrl(false)
        send(k)
      }}
    >
      {k.cap}
    </button>
  )
  const pages = keyPages(atMenu)
  return (
    <div
      className={`mono ${TERM_KEY_ROW}`}
      role="toolbar"
      aria-label={t("layout.termKeys")}
      // A tap must not take focus from xterm's textarea, or the soft keyboard closes.
      onPointerDown={(e) => e.preventDefault()}
    >
      {more && handle && (
        <button
          type="button"
          className={termKey(ctrl ? "on" : "off")}
          aria-pressed={ctrl}
          onClick={() => setCtrl(!ctrl)}
        >
          ctrl
        </button>
      )}
      {(more ? pages.rest : pages.first).map(key)}
      {/* Marked while Ctrl is latched on the page behind it. */}
      <button
        type="button"
        className={termKey(ctrl && !more ? "hint" : "off")}
        aria-expanded={more}
        aria-label={t("layout.termKeyMore")}
        onClick={() => setMore(!more)}
      >
        ⋯
      </button>
    </div>
  )
}
