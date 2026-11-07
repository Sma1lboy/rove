import type { ChangeEvent, ClipboardEvent, KeyboardEvent, ReactNode, RefObject } from "react"

/**
 * The bar under an engine terminal on a touch screen. Talking comes first: with no draft it is attach, a wide
 * hold-to-talk control and a keyboard key; a draft, or the keyboard key, turns it into attach, Say, a message
 * field and Send. Its height never changes (a long message scrolls inside the field; attachment chips float
 * above it, over the terminal's last rows), so the terminal is fitted once and never reflows while you compose.
 * 16px text: iOS zooms the page into any smaller field it focuses.
 */
const BAR = "relative hidden [border-top:var(--hairline)_solid_var(--line)] bg-surface px-1.5 py-1.5 touch:flex"
const CHIPS = "absolute inset-x-1.5 bottom-full z-5 mb-1"
const SUGGEST = "absolute inset-x-1.5 bottom-full z-6 mb-1"
const ROW = "flex min-w-0 flex-1 items-stretch gap-1.5"
const FIELD =
  "h-10 min-w-0 flex-1 resize-none rounded-sm border-hairline border-line bg-inset px-2 py-2 font-sans text-display leading-[1.35] text-ink outline-none focus:border-focus disabled:opacity-60"
/** A pressed control gives a little under the finger; no motion when the system asks for none. */
const PRESS =
  "transition-transform duration-100 active:scale-94 motion-reduce:transition-none motion-reduce:active:scale-none"
const SEND = `h-10 shrink-0 rounded-sm bg-accent px-3.5 font-sans text-meta font-semibold text-paper touch-manipulation disabled:opacity-50 ${PRESS}`

/** The attach control's box, for the caller's file picker. */
export const COMPOSER_ATTACH = `flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-sm border-hairline border-line bg-inset text-muted touch-manipulation has-[:disabled]:opacity-60 ${PRESS}`

/** The dictate control's box: the attach box's height and border, wide enough for `Stop 0:12`. */
export const composerDictate = (recording: boolean): string =>
  `flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-sm border-hairline bg-inset px-2.5 font-sans text-meta disabled:opacity-60 ${PRESS} ${
    recording ? "border-accent text-accent" : "border-line text-muted"
  }`
/** The voice row's hold-to-talk control: the dictate box, as wide as the row allows. */
export const composerHold = (recording: boolean): string => `${composerDictate(recording)} flex-1`

/** The voice row's switch to typing, in the attach box. */
export function KeysButton(props: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={COMPOSER_ATTACH} title={props.label} onClick={props.onClick}>
      <span className="sr-only">{props.label}</span>
      <svg viewBox="0 0 16 16" className="size-4 fill-none stroke-current stroke-[1.4]" aria-hidden="true">
        <path d="M2.5 4h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 6.5h1M7 6.5h1M10 6.5h2M5 9.5h6" />
      </svg>
    </button>
  )
}

export function ClipGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-4 fill-none stroke-current stroke-[1.4]" aria-hidden="true">
      <path d="M10.5 4.5 5.8 9.2a1.4 1.4 0 0 0 2 2l5-5a2.8 2.8 0 0 0-4-4l-5.2 5.2a4.2 4.2 0 0 0 6 6L13 9" />
    </svg>
  )
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
  /** Dictation, boxed in `composerDictate`; it fills the field and never sends. */
  dictate?: ReactNode
  /** The voice row (hold-to-talk and the keyboard key); while set it stands in for Say, the field and Send. */
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
            {props.dictate}
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
            <button type="submit" className={SEND} disabled={props.busy || !props.ready}>
              {props.sendLabel}
            </button>
          </>
        )}
      </div>
    </form>
  )
}
