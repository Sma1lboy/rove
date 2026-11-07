/**
 * The one dictation button. Bracket text like every other composer control, never a floating
 * action: `[ say ]` → `[ stop 0:03 ]` → `[ … ]`. On tapping stop the transcript is handed to
 * `onText`; this component never submits anything itself.
 */

import { useEffect, useRef, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { Dictation } from "./dictation.ts"
import { t, useLocale } from "./i18n/index.ts"
import { useStore } from "./store.ts"
import "./dictation.css"

const clock = (seconds: number) => `0:${String(Math.floor(seconds)).padStart(2, "0")}`

export function DictationButton(props: {
  readonly client: BridgeClient
  /** Read at stop, not at mount: what the shell is looking at is the useful bias. */
  readonly context: () => string
  readonly onText: (text: string) => void
  readonly disabled?: boolean
}) {
  useLocale()
  const dictation = useRef<Dictation | null>(null)
  if (dictation.current === null) dictation.current = new Dictation(props.client, props.context)
  const view = useStore(dictation.current.view)
  const [hosted, setHosted] = useState<boolean | null>(null)

  useEffect(() => {
    props.client
      .request<{ ready: boolean; model: string | null }>("voice.status")
      .then((status) => setHosted(status.ready || status.model !== null))
      .catch(() => setHosted(false))
  }, [props.client])

  // A button that can only fail is worse than no button: the sidecar is opt-in, on the host.
  useEffect(() => () => dictation.current?.cancel(), [])

  const label =
    view.phase === "recording"
      ? t("voice.stop", { time: clock(view.seconds) })
      : view.phase === "transcribing"
        ? t("voice.working")
        : t("voice.say")

  return (
    <button
      type="button"
      className={`composer-chip dictation dictation-${view.phase}`}
      disabled={props.disabled || hosted === false || view.phase === "transcribing"}
      title={view.error ?? (hosted === false ? t("voice.offline") : t("voice.hint"))}
      onClick={() => {
        void dictation.current?.toggle().then((result) => {
          if (result?.text) props.onText(result.text)
        })
      }}
    >
      {label}
      {view.phase === "recording" && (
        <span className="dictation-meter" aria-hidden="true">
          <span className="dictation-dot" style={{ opacity: 0.25 + Math.min(1, view.level * 12) * 0.75 }} />
        </span>
      )}
    </button>
  )
}
