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

/**
 * The voice row's hold-to-talk control: the only filled box in the row, tinted while recording, solid accent once
 * slid up to send. Disabled it greys its text and keeps its opacity: the bubble inside it must stay solid, and above
 * the strip over the terminal.
 */
export const composerHold = (recording: boolean, armed: boolean): string =>
  `relative z-6 flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[12px] border-hairline px-3.5 font-sans touch-manipulation disabled:text-muted ${PRESS_WIDE} ${
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

/** Bars of the last few seconds' loudness, newest at the right; one bar per recorder tick. `wide` fills a bubble. */
function Wave({ level, seconds, wide }: { level: number; seconds: number; wide?: boolean }) {
  // More bars than any phone is wide: the strip is right-aligned and clipped at the left, so it always spans its box.
  const count = wide ? 120 : 80
  const bars = useRef<number[]>([])
  const seen = useRef(-1)
  // Each recorder tick moves `seconds`; any other render keeps the bars where they are.
  if (seconds !== seen.current) {
    seen.current = seconds
    bars.current = [...bars.current, level].slice(-count)
  }
  const strip = [...Array(count - bars.current.length).fill(0), ...bars.current]
  return (
    <span
      className={`flex min-w-0 flex-1 items-center justify-end overflow-hidden ${wide ? "h-10 gap-[3px]" : "h-5.5 gap-[2.5px]"}`}
      aria-hidden="true"
    >
      {strip.map((value, i) => (
        <i
          // biome-ignore lint/suspicious/noArrayIndexKey: a bar is its position in the strip
          key={i}
          // Scaled, not resized: the bars glide to their next height.
          className={`block h-full flex-none rounded-full bg-current transition-transform duration-100 ease-linear motion-reduce:transition-none ${wide ? "w-[3px]" : "w-[2.5px]"}`}
          style={{ transform: `scaleY(${Math.max(wide ? 0.08 : 0.12, Math.min(1, value * 10))})` }}
        />
      ))}
    </span>
  )
}

/** Three dots taking turns: the take is being turned into text. */
function Dots() {
  return (
    <span className="inline-flex items-center gap-[3px] align-middle" aria-hidden="true">
      {[0, 160, 320].map((delay) => (
        <i
          key={delay}
          className="block size-1 rounded-full bg-current motion-safe:animate-dot"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  )
}

interface Bubble {
  readonly text: string
  /** Slid up: letting go sends. */
  readonly armed: boolean
  /** Let go: the words are being finished. */
  readonly waiting: boolean
  readonly level: number
  readonly seconds: number
}

/**
 * Over the hold control from the press until the text lands, and only what is being said: the voice as a
 * waveform until a word is heard, then the words, each fading in. What the finger can do stays in the control
 * under it. It grows out of the control and sinks back when the take is done.
 */
const BUBBLE =
  "pointer-events-none absolute inset-x-0 bottom-full z-6 mb-2.5 flex min-h-17 origin-bottom items-center rounded-[16px] border-hairline bg-surface px-4 py-3 text-left shadow-dialog transition-colors duration-150"
function HoldBubble({ bubble, leaving }: { bubble: Bubble; leaving: boolean }) {
  return (
    <span
      className={`${BUBBLE} ${leaving ? "motion-safe:animate-sink-out" : "motion-safe:animate-bubble-in"} ${bubble.armed ? "border-accent" : "border-line"}`}
    >
      {bubble.text ? (
        // The newest words stay in view; the start of a long take scrolls off the top.
        <span
          key="words"
          // Greyed once the finger lifts: they are not final until they land in the field.
          className={`flex max-h-[5.8em] min-w-0 flex-1 flex-col justify-end overflow-hidden font-sans text-display leading-[1.45] transition-colors duration-150 motion-safe:animate-fade-in ${bubble.waiting ? "text-muted" : "text-ink"}`}
        >
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
        <span key="wave" className="flex min-w-0 flex-1 text-accent">
          <Wave level={bubble.level} seconds={bubble.seconds} wide />
        </span>
      )}
    </span>
  )
}

/** Each face fades in as it takes the control over: the label at rest, the take while recording, the wait after. */
const FACE = "flex min-w-0 flex-1 items-center gap-2.5 motion-safe:animate-fade-in"

/**
 * Inside the hold control. At rest, the label. Held where a slide sends: the level dot, the time, and where to
 * slide; the voice itself is in the bubble above. Elsewhere the take's waveform (or its words) sits in the control.
 */
export function HoldFace(props: {
  state: DictationFace
  idle: string
  working: string
  /** Where to slide and what letting go there does; left out where a take is never sent from the hold. */
  slide?: string
  release?: string
}) {
  const { state } = props
  const recording = state.phase === "recording"
  const transcribing = state.phase === "transcribing"
  const sends = props.slide !== undefined
  const held = recording && state.held
  const heard = useRef("")
  if (recording) heard.current = state.partial
  // Up from the press; after the finger lifts it stays only while it has words to finish.
  const live: Bubble | null =
    sends && (held || ((recording || transcribing) && heard.current !== ""))
      ? {
          text: heard.current,
          armed: held && state.armed,
          waiting: !held,
          level: state.level,
          seconds: state.seconds,
        }
      : null
  const { shown, leaving } = useLinger(live, 140)
  const bubble = shown && <HoldBubble bubble={shown} leaving={leaving} />
  const wait = (
    <span key="working" className={`${FACE} justify-center gap-2 text-body`}>
      {props.working.replace(/…$/, "")}
      <Dots />
    </span>
  )
  if (transcribing || (recording && sends && !held)) {
    return (
      <>
        {bubble}
        {wait}
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
        {sends ? (
          <span
            key={String(state.armed)}
            className={`ml-auto flex flex-none items-center gap-1 text-body motion-safe:animate-fade-in ${state.armed ? "font-semibold" : "opacity-80"}`}
          >
            <svg
              viewBox="0 0 16 16"
              className="size-4 flex-none fill-none stroke-current stroke-[1.5]"
              aria-hidden="true"
            >
              <path d={UP} />
            </svg>
            {state.armed ? props.release : props.slide}
          </span>
        ) : state.partial ? (
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
