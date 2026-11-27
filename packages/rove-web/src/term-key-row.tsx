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

export function TermKeyRow({ handle, atMenu }: { handle: TermHandle; atMenu: boolean }) {
  useLocale()
  const [ctrl, setCtrl] = useState(false)
  const [more, setMore] = useState(false)
  useEffect(() => {
    handle.armCtrl(ctrl ? () => setCtrl(false) : null)
  }, [handle, ctrl])
  useEffect(() => () => handle.armCtrl(null), [handle])
  const { term } = handle
  const key = (k: TermKey) => (
    <button
      key={k.id}
      type="button"
      className={termKey(false)}
      aria-label={KEY_NAMES[k.id] ? t(KEY_NAMES[k.id]) : undefined}
      onClick={() => {
        setCtrl(false)
        term.input(k.bytes(term.modes.applicationCursorKeysMode), true)
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
      {more && (
        <button type="button" className={termKey(ctrl)} aria-pressed={ctrl} onClick={() => setCtrl(!ctrl)}>
          ctrl
        </button>
      )}
      {(more ? pages.rest : pages.first).map(key)}
      {/* Lit while Ctrl is latched on the page behind it. */}
      <button
        type="button"
        className={termKey(ctrl && !more)}
        aria-expanded={more}
        aria-label={t("layout.termKeyMore")}
        onClick={() => setMore(!more)}
      >
        ⋯
      </button>
    </div>
  )
}
