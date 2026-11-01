import type { ClipboardEvent, ReactNode } from "react"

/**
 * The bar under an engine terminal on a touch screen: an attach control, a message field and Send.
 * Its height never changes (a long message scrolls inside the field), so the terminal above is fitted once
 * and never reflows while you type. 16px text: iOS zooms the page into any smaller field it focuses.
 */
const BAR = "hidden flex-col gap-1 [border-top:var(--hairline)_solid_var(--line)] bg-surface px-1.5 py-1.5 touch:flex"
const ROW = "flex items-stretch gap-1.5"
const FIELD =
  "h-10 min-w-0 flex-1 resize-none rounded-[6px] border-hairline border-line bg-inset px-2 py-2 font-sans text-[16px] leading-[1.35] text-ink outline-none focus:border-focus disabled:opacity-60"
const SEND =
  "h-10 shrink-0 rounded-[6px] bg-accent px-3.5 font-sans text-meta font-semibold text-paper touch-manipulation active:scale-97 motion-reduce:active:scale-none disabled:opacity-50"

/** The attach control's box, for the caller's file picker. */
export const COMPOSER_ATTACH =
  "flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-hairline border-line bg-inset text-muted touch-manipulation has-[:disabled]:opacity-60"

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
  /** Chips for what is attached, above the field. */
  attached?: ReactNode
  /** The file picker, boxed in `COMPOSER_ATTACH`. */
  attach: ReactNode
  onChange: (text: string) => void
  onPaste: (e: ClipboardEvent) => void
  onSend: () => void
}) {
  return (
    <form
      className={BAR}
      onSubmit={(e) => {
        e.preventDefault()
        props.onSend()
      }}
    >
      {props.attached}
      <div className={ROW}>
        {props.attach}
        <textarea
          className={FIELD}
          rows={1}
          value={props.value}
          placeholder={props.placeholder}
          disabled={props.busy}
          enterKeyHint="send"
          onChange={(e) => props.onChange(e.target.value)}
          onPaste={props.onPaste}
        />
        <button type="submit" className={SEND} disabled={props.busy || !props.ready}>
          {props.sendLabel}
        </button>
      </div>
    </form>
  )
}
