import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useRef,
} from "react"
import type { DictationFace } from "../voice/dictation-button.tsx"

/**
 * The bar under an engine terminal on a touch screen. Talking comes first: with no draft it is attach, a wide
 * hold-to-talk control and a keyboard key; a draft, or the keyboard key, turns it into attach, a message field, a
 * mic and Send. One filled control per row: the side keys are bare glyphs on 44px hit areas. Its height never
 * changes (a long message scrolls inside the field; attachment chips float above it, over the terminal's last
 * rows), so the terminal is fitted once and never reflows while you compose. 16px text: iOS zooms the page into
 * any smaller field it focuses.
 */
const BAR = "relative hidden [border-top:var(--hairline)_solid_var(--line)] bg-surface px-3 pt-2.5 pb-3.5 touch:flex"
const CHIPS = "absolute inset-x-3 bottom-full z-5 mb-1"
const SUGGEST = "absolute inset-x-3 bottom-full z-6 mb-1"
const ROW = "flex min-w-0 flex-1 items-center gap-2.5"
/** One line as tall as the box: a longer draft scrolls a whole line at a time, so no half line peeks in below. */
const FIELD =
  "h-11 min-w-0 flex-1 resize-none rounded-[12px] border-hairline border-line bg-inset px-3.5 py-0 font-sans text-display leading-[42px] text-ink outline-none focus:border-focus disabled:opacity-60"
/** A pressed control gives a little under the finger; no motion when the system asks for none. */
const PRESS =
  "transition-transform duration-100 active:scale-94 motion-reduce:transition-none motion-reduce:active:scale-none"
/** The hold control stays pressed for the whole take: it gives less, or the row would look shrunk. */
const PRESS_WIDE =
  "transition-transform duration-100 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-none"
const SEND = `flex size-11 shrink-0 items-center justify-center rounded-[12px] border-hairline border-accent text-accent touch-manipulation disabled:border-line disabled:text-muted disabled:opacity-60 ${PRESS}`
const KEY = `flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] touch-manipulation active:bg-inset disabled:opacity-60 has-[:disabled]:opacity-60 ${PRESS}`
const GLYPH = "size-4.5 flex-none fill-none stroke-current stroke-[1.5] [stroke-linecap:round] [stroke-linejoin:round]"

/** A side key: attach, the keyboard switch, the mic beside the field. */
export const COMPOSER_ATTACH = `${KEY} text-muted`
export const composerMic = (recording: boolean): string => `${KEY} ${recording ? "text-accent" : "text-muted"}`

/** The voice row's hold-to-talk control: the only filled box in the row, lit while recording, tinted once slid up to send. */
export const composerHold = (recording: boolean, armed: boolean): string =>
  `flex h-11 min-w-0 flex-1 items-center gap-2.5 overflow-hidden rounded-[12px] border-hairline px-3.5 font-sans touch-manipulation disabled:opacity-60 ${PRESS_WIDE} ${
    armed
      ? "border-accent bg-accent-soft text-accent"
      : recording
        ? "border-accent bg-paper text-accent"
        : "border-line bg-inset text-ink"
  }`

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 16 16" className={GLYPH} aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/** Fills the box as the paperclip does (x 3–13, y 1.5–14.5), so the two read as one size side by side. */
const MIC = "M8 1.5a2.5 2.5 0 0 1 2.5 2.5v4.5a2.5 2.5 0 0 1-5 0V4A2.5 2.5 0 0 1 8 1.5zM3 8a5 5 0 0 0 10 0M8 13v1.5"
const UP = "M8 13V3M3.5 7.5 8 3l4.5 4.5"

export function ClipGlyph() {
  return <Glyph d="M10.5 4.5 5.8 9.2a1.4 1.4 0 0 0 2 2l5-5a2.8 2.8 0 0 0-4-4l-5.2 5.2a4.2 4.2 0 0 0 6 6L13 9" />
}

/** The voice row's switch to typing. */
export function KeysButton(props: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={COMPOSER_ATTACH} title={props.label} onClick={props.onClick}>
      <span className="sr-only">{props.label}</span>
      <Glyph d="M2.5 4h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 6.5h1M7 6.5h1M10 6.5h2M5 9.5h6" />
    </button>
  )
}

/** Bars of the last few seconds' loudness, newest at the right; one bar per recorder tick. */
const BARS = 40
function Wave({ level, seconds }: { level: number; seconds: number }) {
  const bars = useRef<number[]>(Array(BARS).fill(0))
  const seen = useRef(-1)
  // Each recorder tick moves `seconds`; any other render keeps the bars where they are.
  if (seconds !== seen.current) {
    seen.current = seconds
    bars.current = [...bars.current.slice(1), level]
  }
  return (
    <span className="flex h-5.5 min-w-0 flex-1 items-center justify-end gap-[2.5px] overflow-hidden" aria-hidden="true">
      {bars.current.map((value, i) => (
        <i
          // biome-ignore lint/suspicious/noArrayIndexKey: a bar is its position in the strip
          key={i}
          className="block w-[2.5px] flex-none rounded-full bg-current"
          style={{ height: `${Math.max(3, Math.round(Math.min(1, value * 10) * 22))}px` }}
        />
      ))}
    </span>
  )
}

/** Inside the hold control: the label at rest; while recording a level dot, the time, the waveform and (held) where to slide. */
export function HoldFace(props: {
  state: DictationFace
  idle: string
  working: string
  /** Where to slide and what letting go there does; left out where a take is never sent from the hold. */
  slide?: string
  release?: string
}) {
  const { state } = props
  if (state.phase === "transcribing") return <span className="flex-1 text-center text-meta">{props.working}</span>
  if (state.phase !== "recording") {
    return (
      <span className="flex flex-1 items-center justify-center gap-2 text-display font-medium">
        <Glyph d={MIC} />
        {props.idle}
      </span>
    )
  }
  return (
    <>
      {/* Opacity carries the level: the dot never resizes and never pushes the time around. */}
      <span
        className="size-1.75 flex-none rounded-full bg-current"
        style={{ opacity: 0.3 + Math.min(1, state.level * 10) * 0.7 }}
      />
      <span className="flex-none font-mono text-meta normal-nums">{state.time}</span>
      {state.partial ? (
        // The newest words at the right edge, where the waveform was; the start of a long take scrolls off left.
        <span className="flex min-w-0 flex-1 justify-end overflow-hidden whitespace-nowrap text-meta">
          {state.partial}
        </span>
      ) : (
        <Wave level={state.level} seconds={state.seconds} />
      )}
      {state.held && props.slide && (
        <span className={`flex flex-none items-center gap-1 text-meta ${state.armed ? "font-semibold" : "text-muted"}`}>
          <svg viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current stroke-[1.5]" aria-hidden="true">
            <path d={UP} />
          </svg>
          {/* Once words show they need the room; the arrow alone still says where to slide. */}
          {state.armed ? props.release : state.partial ? <span className="sr-only">{props.slide}</span> : props.slide}
        </span>
      )}
    </>
  )
}

/** Inside the mic beside the field: the glyph, or the take's time while it records. */
export function MicFace({ state }: { state: DictationFace }) {
  if (state.phase === "recording") return <span className="font-mono text-meta normal-nums">{state.time}</span>
  if (state.phase === "transcribing") return <span className="font-mono text-meta">…</span>
  return <Glyph d={MIC} />
}

export function TermComposerBar(props: {
  value: string
  placeholder: string
  sendLabel: string
  busy: boolean
  /** Something to send: text or an attachment. */
  ready: boolean
  /** Chips for what is attached, floated above the field. */
  attached?: ReactNode
  /** The file picker, boxed in `COMPOSER_ATTACH`. */
  attach: ReactNode
  /** The mic beside the field, boxed in `composerMic`; it fills the field and never sends. */
  dictate?: ReactNode
  /** The voice row (hold-to-talk and the keyboard key); while set it stands in for the field, the mic and Send. */
  voice?: ReactNode
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void
  onPaste: (e: ClipboardEvent) => void
  onSelect?: (e: { currentTarget: HTMLTextAreaElement }) => void
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  fieldRef?: RefObject<HTMLTextAreaElement | null>
  /** Names this composer so a quote from the terminal above can find it. */
  composerKey?: string
  /** The `@name` suggestions, floated over the terminal like the chips. */
  suggest?: ReactNode
  onSend: () => void
}) {
  return (
    <form
      className={BAR}
      data-composer={props.composerKey}
      onSubmit={(e) => {
        e.preventDefault()
        props.onSend()
      }}
    >
      {props.attached && <div className={CHIPS}>{props.attached}</div>}
      {props.suggest && <div className={SUGGEST}>{props.suggest}</div>}
      <div className={ROW}>
        {props.attach}
        {props.voice ?? (
          <>
            <textarea
              ref={props.fieldRef}
              className={FIELD}
              rows={1}
              value={props.value}
              placeholder={props.placeholder}
              disabled={props.busy}
              enterKeyHint="send"
              onChange={props.onChange}
              onSelect={props.onSelect}
              onKeyDown={props.onKeyDown}
              onPaste={props.onPaste}
            />
            {props.dictate}
            <button type="submit" className={SEND} title={props.sendLabel} disabled={props.busy || !props.ready}>
              <span className="sr-only">{props.sendLabel}</span>
              <Glyph d={UP} />
            </button>
          </>
        )}
      </div>
    </form>
  )
}
