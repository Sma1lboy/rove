import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react"
import type { DictationFace } from "../voice/dictation-button.tsx"

/**
 * The bar under an engine terminal on a touch screen. Talking comes first: with no draft it is attach and one wide
 * control that is held to talk and tapped to type; a draft, or the tap, turns it into attach, a message field with
 * the mic inside it, and Send. One filled control per row: the side keys are bare glyphs on 44px hit areas. Its height never
 * changes (a long message scrolls inside the field; attachment chips float above it, over the terminal's last
 * rows), so the terminal is fitted once and never reflows while you compose. 16px text: iOS zooms the page into
 * any smaller field it focuses.
 */
const BAR = "relative hidden [border-top:var(--hairline)_solid_var(--line)] bg-surface px-3 pt-2.5 pb-3.5 touch:flex"
const CHIPS = "absolute inset-x-3 bottom-full z-5 mb-1"
const SUGGEST = "absolute inset-x-3 bottom-full z-6 mb-1"
const ROW = "flex min-w-0 flex-1 items-center gap-2.5"
/** The field's box: the mic sits inside it, at its right end. */
const FIELD_BOX =
  "flex h-11 min-w-0 flex-1 items-center rounded-[12px] border-hairline border-line bg-inset focus-within:border-focus has-[textarea:disabled]:opacity-60"
/** One line as tall as the box: a longer draft scrolls a whole line at a time, so no half line peeks in below. */
const FIELD =
  "h-full min-w-0 flex-1 resize-none bg-transparent py-0 pr-3.5 pl-3.5 font-sans text-display leading-[42px] text-ink outline-none [border:0] has-[+button]:pr-0"
/** A pressed control gives a little under the finger; no motion when the system asks for none. */
const PRESS =
  "transition-transform duration-100 active:scale-94 motion-reduce:transition-none motion-reduce:active:scale-none"
/** The hold control stays pressed for the whole take: it gives less, or the row would look shrunk. */
const PRESS_WIDE =
  "transition-[scale,background-color,border-color,color] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-none"
const SEND = `flex size-11 shrink-0 items-center justify-center rounded-[12px] border-hairline border-accent text-accent touch-manipulation disabled:border-line disabled:text-muted disabled:opacity-60 ${PRESS}`
const KEY = `flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] touch-manipulation active:bg-inset disabled:opacity-60 has-[:disabled]:opacity-60 ${PRESS}`
const GLYPH = "size-4.5 flex-none fill-none stroke-current stroke-[1.5] [stroke-linecap:round] [stroke-linejoin:round]"

/** A side key: attach, and the mic inside the field. */
export const COMPOSER_ATTACH = `${KEY} text-muted`
export const composerMic = (recording: boolean): string => `${KEY} ${recording ? "text-accent" : "text-muted"}`

/** The voice row's hold-to-talk control: the only filled box in the row, tinted while recording, solid accent once slid up to send. */
export const composerHold = (recording: boolean, armed: boolean): string =>
  `relative flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[12px] border-hairline px-3.5 font-sans touch-manipulation disabled:opacity-60 ${PRESS_WIDE} ${
    armed
      ? "border-accent bg-accent text-paper"
      : recording
        ? "border-accent bg-accent-soft text-accent"
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

export function SendButton(props: { label: string; disabled: boolean }) {
  return (
    <button type="submit" className={SEND} title={props.label} disabled={props.disabled}>
      <span className="sr-only">{props.label}</span>
      <Glyph d={UP} />
    </button>
  )
}

/** What it last held, kept for `ms` after it is gone, so a bubble leaves the way it came instead of vanishing. */
function useLinger<T>(value: T | null, ms: number): { shown: T | null; leaving: boolean } {
  const last = useRef(value)
  if (value !== null) last.current = value
  const absent = value === null
  const [gone, setGone] = useState(absent)
  useEffect(() => {
    if (!absent) return setGone(false)
    const timer = window.setTimeout(() => setGone(true), ms)
    return () => window.clearTimeout(timer)
  }, [absent, ms])
  return { shown: value ?? (gone ? null : last.current), leaving: absent && !gone }
}

/** Words, so each new one can fade in by itself; the browser's own word breaking where it has one (no spaces in Chinese). */
function words(text: string): string[] {
  if (typeof Intl.Segmenter !== "function") return text.split(/(\s+)/)
  return [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)].map((part) => part.segment)
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
          // Scaled, not resized: the bars glide to their next height.
          className="block h-full w-[2.5px] flex-none rounded-full bg-current transition-transform duration-100 ease-linear motion-reduce:transition-none"
          style={{ transform: `scaleY(${Math.max(0.12, Math.min(1, value * 10))})` }}
        />
      ))}
    </span>
  )
}

interface Bubble {
  readonly text: string
  readonly hint: string
  /** The hint is where to slide, so it carries the arrow. */
  readonly slide: boolean
  readonly armed: boolean
  /** In the words' place until the first one is heard. */
  readonly listening: string
}

/**
 * Over the hold control from the press until the text lands: the words as they are heard, and under them where
 * to slide to send. It grows out of the control and sinks back when the take is done.
 */
const BUBBLE =
  "pointer-events-none absolute inset-x-0 bottom-full z-6 mb-2.5 flex origin-bottom flex-col gap-2.5 rounded-[16px] border-hairline bg-surface px-4 pt-3.5 pb-3 text-left shadow-dialog transition-colors duration-150"
function HoldBubble({ bubble, leaving }: { bubble: Bubble; leaving: boolean }) {
  return (
    <span
      className={`${BUBBLE} ${leaving ? "motion-safe:animate-sink-out" : "motion-safe:animate-bubble-in"} ${bubble.armed ? "border-accent" : "border-line"}`}
    >
      {bubble.text ? (
        // Two lines tall from the first word, so the box does not jump; the newest words stay in view.
        <span className="flex max-h-[5.8em] min-h-[2.9em] flex-col justify-end overflow-hidden font-sans text-display leading-[1.45] text-ink">
          <span>
            {words(bubble.text).map((word, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a word is its place in the take; only new ones mount
              <span key={i} className="motion-safe:animate-fade-in">
                {word}
              </span>
            ))}
          </span>
        </span>
      ) : (
        <span className="flex min-h-[2.9em] items-end font-sans text-display leading-[1.45] text-subtle">
          {bubble.listening}
        </span>
      )}
      <span
        key={bubble.hint}
        className={`flex items-center justify-center gap-1.5 text-body motion-safe:animate-fade-in ${bubble.armed ? "font-semibold text-accent" : "text-muted"}`}
      >
        {bubble.slide && (
          <svg
            viewBox="0 0 16 16"
            className="size-4 flex-none fill-none stroke-current stroke-[1.5]"
            aria-hidden="true"
          >
            <path d={UP} />
          </svg>
        )}
        {bubble.hint}
      </span>
    </span>
  )
}

/** Each face fades in as it takes the control over: the label at rest, the take while recording, the wait after. */
const FACE = "flex min-w-0 flex-1 items-center gap-2.5 motion-safe:animate-fade-in"

/** Inside the hold control: the label at rest; while recording a level dot, the time and the waveform. */
export function HoldFace(props: {
  state: DictationFace
  idle: string
  working: string
  /** Where to slide and what letting go there does; left out where a take is never sent from the hold. */
  slide?: string
  release?: string
  listening?: string
}) {
  const { state } = props
  const recording = state.phase === "recording"
  const held = recording && state.held
  // Where a slide sends, every take is a hold: the bubble is up from the press until the text lands.
  const heard = useRef("")
  if (recording) heard.current = state.partial
  const live: Bubble | null =
    props.slide !== undefined && (recording || state.phase === "transcribing")
      ? {
          text: heard.current,
          hint: (held ? (state.armed ? props.release : props.slide) : props.working) ?? "",
          slide: held,
          armed: held && state.armed,
          listening: props.listening ?? "",
        }
      : null
  const { shown, leaving } = useLinger(live, 140)
  const bubble = shown && <HoldBubble bubble={shown} leaving={leaving} />
  if (state.phase === "transcribing") {
    return (
      <>
        {bubble}
        <span key="working" className={`${FACE} justify-center text-body`}>
          {props.working}
        </span>
      </>
    )
  }
  if (!recording) {
    return (
      <>
        {bubble}
        <span key="idle" className={`${FACE} justify-center gap-2 text-display`}>
          <span className="flex text-muted">
            <Glyph d={MIC} />
          </span>
          {props.idle}
        </span>
      </>
    )
  }
  return (
    <>
      {bubble}
      <span key="take" className={FACE}>
        {/* Opacity carries the level: the dot never resizes and never pushes the time around. */}
        <span
          className="size-2 flex-none rounded-full bg-current"
          style={{ opacity: 0.3 + Math.min(1, state.level * 10) * 0.7 }}
        />
        <span className="flex-none font-mono text-body normal-nums">{state.time}</span>
        {state.partial && props.slide === undefined ? (
          // The newest words at the right edge, where the waveform was; the start of a long take scrolls off left.
          <span className="flex min-w-0 flex-1 justify-end overflow-hidden whitespace-nowrap text-meta">
            {state.partial}
          </span>
        ) : (
          <Wave level={state.level} seconds={state.seconds} />
        )}
      </span>
    </>
  )
}

/** Inside the mic in the field: the glyph, or the take's time while it records. */
export function MicFace({ state }: { state: DictationFace }) {
  if (state.phase === "recording") return <span className="font-mono text-meta normal-nums">{state.time}</span>
  if (state.phase === "transcribing") return <span className="font-mono text-meta">…</span>
  return <Glyph d={MIC} />
}

/** The New session card's mic: the hold control's face on a phone that talks first, the icon's elsewhere. */
export function CardMicFace(props: { state: DictationFace; hold: boolean; idle: string; working: string }) {
  if (!props.hold) return <MicFace state={props.state} />
  return <HoldFace state={props.state} idle={props.idle} working={props.working} />
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
  /** The mic inside the field, boxed in `composerMic`; it fills the field and never sends. */
  dictate?: ReactNode
  /** The voice row (the hold-to-talk control); while set it stands in for the field, the mic and Send. */
  voice?: ReactNode
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void
  onPaste: (e: ClipboardEvent) => void
  onBlur?: () => void
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
            <div className={FIELD_BOX}>
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
                onBlur={props.onBlur}
              />
              {props.dictate}
            </div>
            <SendButton label={props.sendLabel} disabled={props.busy || !props.ready} />
          </>
        )}
      </div>
    </form>
  )
}
