/**
 * The one dictation button. Bracket text like every other composer control, never a floating
 * action: `Say` → `Stop 0:03` → `Hearing…`. Two ways to talk: tap to start and tap again to stop, or
 * hold it and let go. Either hands the transcript to `onText`; only a hold slid up past `SEND_PX`
 * hands it to `onSend` instead, and only where the caller passes one.
 */

import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react"
import type { BridgeClient } from "./bridge.ts"
import { Dictation, type DictationPhase, type DictationResult } from "./dictation.ts"
import { t, useLocale } from "./i18n/index.ts"
import { useStore } from "./store.ts"
import * as C from "./ui/composer.ts"

const clock = (seconds: number) => `0:${String(Math.floor(seconds)).padStart(2, "0")}`
/** A press held this long is a hold, not a tap. */
const HOLD_MS = 300
/** How far up a held press slides before letting go sends. */
const SEND_PX = 48
/** A short tick where the platform has one (Android); iOS Safari has no vibration. */
const tick = () => navigator.vibrate?.(8)

interface Press {
  readonly y: number
  timer: number
  held: boolean
  armed: boolean
  started: Promise<unknown> | null
}

export interface DictationFace {
  readonly phase: DictationPhase
  /** `0:03` */
  readonly time: string
  readonly seconds: number
  /** Loudness of the last tick, 0–1. */
  readonly level: number
  /** Recording because the button is held, not tapped: letting go stops it. */
  readonly held: boolean
  /** Held and slid up: letting go sends. */
  readonly armed: boolean
}

/** One `voice.status` per bridge: the bar and every button ask the same question. */
const hostedBy = new WeakMap<BridgeClient, Promise<boolean>>()
/** Whether this host runs the voice sidecar; null while asking. */
export function useVoiceHosted(client: BridgeClient): boolean | null {
  const [hosted, setHosted] = useState<boolean | null>(null)
  useEffect(() => {
    let ask = hostedBy.get(client)
    if (!ask) {
      ask = client
        .request<{ ready: boolean; model: string | null }>("voice.status")
        .then((status) => status.ready || status.model !== null)
        .catch(() => false)
        // A sidecar started later is found by the next mount; a yes holds for the page.
        .then((value) => {
          if (!value) hostedBy.delete(client)
          return value
        })
      hostedBy.set(client, ask)
    }
    let live = true
    void ask.then((value) => live && setHosted(value))
    return () => {
      live = false
    }
  }, [client])
  return hosted
}

export function DictationButton(props: {
  readonly client: BridgeClient
  /** Read at stop, not at mount: what the shell is looking at is the useful bias. */
  readonly context: () => string
  readonly onText: (text: string) => void
  /** Where a hold slid up sends the transcript; without it the slide does nothing. */
  readonly onSend?: (text: string) => void
  readonly disabled?: boolean
  /** The box, by recording state and whether a hold is slid up to send; defaults to a composer-bar chip. */
  readonly look?: (recording: boolean, armed: boolean) => string
  /** The idle label (the accessible name when `face` draws the inside); defaults to `Say`. */
  readonly idle?: string
  /** Draws the inside instead of the text label: a waveform, an icon. */
  readonly face?: (state: DictationFace) => ReactNode
}) {
  useLocale()
  // The recorder outlives renders; it must read the context and callbacks as they are at stop, not at mount.
  const latest = useRef(props)
  latest.current = props
  const dictation = useRef<Dictation | null>(null)
  if (dictation.current === null) dictation.current = new Dictation(props.client, () => latest.current.context())
  const view = useStore(dictation.current.view)
  const hosted = useVoiceHosted(props.client)
  const press = useRef<Press | null>(null)
  const [hold, setHold] = useState<{ armed: boolean } | null>(null)

  // A button that can only fail is worse than no button: the sidecar is opt-in, on the host.
  useEffect(
    () => () => {
      if (press.current) window.clearTimeout(press.current.timer)
      dictation.current?.cancel()
    },
    [],
  )

  const deliver = (result: DictationResult | null, send: boolean) => {
    if (!result?.text) return
    const { onSend, onText } = latest.current
    if (send && onSend) onSend(result.text)
    else onText(result.text)
  }
  const toggle = () => void dictation.current?.toggle().then((result) => deliver(result, false))

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p: Press = { y: e.clientY, timer: 0, held: false, armed: false, started: null }
    // Only an idle recorder can be held; a tap-started recording is stopped by the next tap.
    if (view.phase === "idle" || view.phase === "error") {
      p.timer = window.setTimeout(() => {
        p.held = true
        p.started = dictation.current?.start() ?? null
        setHold({ armed: false })
        tick()
      }, HOLD_MS)
    }
    press.current = p
  }
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current
    if (!p?.held || !latest.current.onSend) return
    const armed = p.y - e.clientY > SEND_PX
    if (armed === p.armed) return
    p.armed = armed
    setHold({ armed })
    tick()
  }
  const up = async () => {
    const p = press.current
    press.current = null
    if (!p) return
    window.clearTimeout(p.timer)
    if (!p.held) return toggle()
    setHold(null)
    await p.started
    deliver((await dictation.current?.stop()) ?? null, p.armed)
  }
  const cancel = async () => {
    const p = press.current
    press.current = null
    if (!p) return
    window.clearTimeout(p.timer)
    if (!p.held) return
    setHold(null)
    await p.started
    dictation.current?.cancel()
  }

  const label =
    view.phase === "recording"
      ? t(hold ? "voice.release" : "voice.stop", { time: clock(view.seconds) })
      : view.phase === "transcribing"
        ? t("voice.working")
        : (props.idle ?? t("voice.say"))
  const recording = view.phase === "recording"
  const armed = hold?.armed ?? false

  return (
    <button
      type="button"
      className={`${(props.look ?? C.dictateChip)(recording, armed)} ${C.DICTATE_PRESS}`}
      disabled={props.disabled || hosted === false || view.phase === "transcribing"}
      title={view.error ?? (hosted === false ? t("voice.offline") : t("voice.hint"))}
      aria-label={props.face ? label : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={() => void up()}
      onPointerCancel={() => void cancel()}
      onContextMenu={(e) => e.preventDefault()}
      // Pointer presses are handled above; a click with no pointer behind it is Enter or Space.
      onClick={(e) => e.detail === 0 && toggle()}
    >
      {props.face ? (
        props.face({
          phase: view.phase,
          time: clock(view.seconds),
          seconds: view.seconds,
          level: view.level,
          held: hold !== null,
          armed,
        })
      ) : (
        <>
          {label}
          {recording && (
            <span className="inline-flex items-center" aria-hidden="true">
              {/* Opacity carries the level: the dot never resizes and never pushes the label around. */}
              <span
                className="size-1.5 rounded-full bg-current"
                style={{ opacity: 0.25 + Math.min(1, view.level * 12) * 0.75 }}
              />
            </span>
          )}
        </>
      )}
    </button>
  )
}
