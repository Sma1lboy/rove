/** New session's `[ later… ]`: the time field that starts the session by itself at that time instead of now. */

import { useState } from "react"
import { t } from "./i18n/index.ts"
import { parseStartAt } from "./schedule-start.ts"
import { Button } from "./ui/button.tsx"
import * as C from "./ui/composer.ts"
import { INPUT } from "./ui/text.ts"

export function LaterControl(props: {
  disabled: boolean
  /** The time was understood and lies ahead. */
  onSchedule: (at: Date) => void
  onInvalid: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const submit = () => {
    const at = parseStartAt(text, new Date())
    if (at) props.onSchedule(at)
    else props.onInvalid(t("newSession.laterBad"))
  }
  return (
    <>
      {open && (
        <input
          className={`${INPUT} min-w-0 flex-1 basis-40`}
          value={text}
          placeholder={t("newSession.laterPlaceholder")}
          aria-label={t("newSession.later")}
          spellCheck={false}
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: the field opens on a click and is what that click asked for
          autoFocus
          disabled={props.disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault()
              e.stopPropagation()
              submit()
            } else if (e.key === "Escape") {
              e.stopPropagation()
              setOpen(false)
            }
          }}
        />
      )}
      <Button
        variant="row"
        className={C.chipClass(open)}
        aria-pressed={open}
        disabled={props.disabled}
        onClick={() => (open && text.trim() ? submit() : setOpen(!open))}
      >
        {t(open && text.trim() ? "newSession.laterConfirm" : "newSession.later")}
      </Button>
    </>
  )
}
