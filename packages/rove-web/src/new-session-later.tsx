/** New session's Later: a time field that starts the session by itself at that time instead of now (in the `⋯` menu). */

import { displayWidth } from "@sma1lboy/rove-core/lib/display-width.ts"
import { useState } from "react"
import { t } from "./i18n/index.ts"
import { parseStartAt } from "./schedule-start.ts"
import { Button } from "./ui/button.tsx"
import * as C from "./ui/composer.ts"
import { INPUT_FRAME } from "./ui/text.ts"

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
  const placeholder = t("newSession.laterPlaceholder")
  return (
    <div className={C.LATER}>
      <input
        className={`${INPUT_FRAME} flex-1 px-2.5 py-2`}
        value={text}
        placeholder={placeholder}
        // Wide enough for the examples it shows, and no narrower: the popover is as wide as its content needs.
        size={displayWidth(placeholder)}
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
      <Button variant="filled" className="shrink-0" disabled={!text.trim()} onClick={submit}>
        {t("newSession.laterConfirm")}
      </Button>
    </div>
  )
}
