/** New session's Later: a time field that starts the session by itself at that time instead of now (in the `⋯` menu). */

import { useState } from "react"
import { t } from "./i18n/index.ts"
import { parseStartAt } from "./schedule-start.ts"
import { Button } from "./ui/button.tsx"
import * as C from "./ui/composer.ts"
import { INPUT } from "./ui/text.ts"

export function LaterField(props: {
  /** The time was understood and lies ahead. */
  onSchedule: (at: Date) => void
  onInvalid: (message: string) => void
  /** Escape: back to the menu it opened from. */
  onBack: () => void
}) {
  const [text, setText] = useState("")
  const submit = () => {
    const at = parseStartAt(text, new Date())
    if (!at) return props.onInvalid(t("newSession.laterBad"))
    props.onSchedule(at)
  }
  return (
    <div className={C.LATER}>
      <input
        className={`${INPUT} min-w-0 flex-1`}
        value={text}
        placeholder={t("newSession.laterPlaceholder")}
        aria-label={t("newSession.later")}
        spellCheck={false}
        autoComplete="off"
        // biome-ignore lint/a11y/noAutofocus: the field opens on a click and is what that click asked for
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            e.stopPropagation()
            return props.onBack()
          }
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return
          e.preventDefault()
          e.stopPropagation()
          submit()
        }}
      />
      <Button variant="filled" disabled={!text.trim()} onClick={submit}>
        {t("newSession.laterConfirm")}
      </Button>
    </div>
  )
}
