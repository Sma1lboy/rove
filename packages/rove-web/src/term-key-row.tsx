/** A touch screen's key row under the terminal: esc, tab, a sticky Ctrl, ^C and the arrows. */

import { useEffect, useState } from "react"
import { t, useLocale } from "./i18n/index.ts"
import { TERM_KEYS } from "./term-keys.ts"
import type { TermHandle } from "./term-mount.ts"

export function TermKeyRow({ handle }: { handle: TermHandle }) {
  useLocale()
  const [ctrl, setCtrl] = useState(false)
  useEffect(() => {
    handle.armCtrl(ctrl ? () => setCtrl(false) : null)
  }, [handle, ctrl])
  useEffect(() => () => handle.armCtrl(null), [handle])
  const { term } = handle
  return (
    <div
      className="term-keys mono"
      role="toolbar"
      aria-label={t("layout.termKeys")}
      // A tap must not take focus from xterm's textarea, or the soft keyboard closes.
      onPointerDown={(e) => e.preventDefault()}
    >
      <button type="button" className={ctrl ? "is-on" : ""} aria-pressed={ctrl} onClick={() => setCtrl(!ctrl)}>
        ctrl
      </button>
      {TERM_KEYS.map((key) => (
        <button
          key={key.id}
          type="button"
          onClick={() => {
            setCtrl(false)
            term.input(key.bytes(term.modes.applicationCursorKeysMode), true)
          }}
        >
          {key.cap}
        </button>
      ))}
    </div>
  )
}
