/**
 * The one dictation button. Bracket text like every other composer control, never a floating
 * action: `Say` → `Stop 0:03` → `Hearing…`. On tapping stop the transcript is handed to
 * `onText`; this component never submits anything itself.
 */

import { useEffect, useRef, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { Dictation } from "./dictation.ts"
import { t, useLocale } from "./i18n/index.ts"
import { useStore } from "./store.ts"
import * as C from "./ui/composer.ts"

const clock = (seconds: number) => `0:${String(Math.floor(seconds)).padStart(2, "0")}`

export function DictationButton(props: {
  readonly client: BridgeClient
  /** Read at stop, not at mount: what the shell is looking at is the useful bias. */
  readonly context: () => string
  readonly onText: (text: string) => void
  readonly disabled?: boolean
  /** The box, by recording state; defaults to a composer-bar chip. */
  readonly look?: (recording: boolean) => string
}) {
  useLocale()
  // The recorder outlives renders; it must read the context as it is at stop, not at mount.
  const context = useRef(props.context)
  context.current = props.context
  const dictation = useRef<Dictation | null>(null)
  if (dictation.current === null) dictation.current = new Dictation(props.client, () => context.current())
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
      className={(props.look ?? C.dictateChip)(view.phase === "recording")}
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
        <span className="inline-flex items-center" aria-hidden="true">
          {/* Opacity carries the level: the dot never resizes and never pushes the label around. */}
          <span
            className="size-1.5 rounded-full bg-current"
            style={{ opacity: 0.25 + Math.min(1, view.level * 12) * 0.75 }}
          />
        </span>
      )}
    </button>
  )
}
