/** New session's Later chip: a popover time field that starts the session by itself at that time instead of now. */

import { useState } from "react"
import { t } from "./i18n/index.ts"
import { ClockIcon } from "./new-session-icons.tsx"
import { ChipPopover } from "./new-session-menus.tsx"
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
  const [text, setText] = useState("")
  return (
    <ChipPopover
      field="later"
      title={t("newSession.later")}
      disabled={props.disabled}
      label={
        <>
          <ClockIcon />
          {t("newSession.later")}
        </>
      }
    >
      {(close) => {
        const submit = () => {
          const at = parseStartAt(text, new Date())
          if (!at) return props.onInvalid(t("newSession.laterBad"))
          close()
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
      }}
    </ChipPopover>
  )
}
