import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"

const SCRIM = "fixed inset-0 z-50 flex items-end bg-[var(--scrim)] motion-safe:animate-fade-in"
const PANEL =
  "static m-0 flex max-h-[70dvh] w-full max-w-none flex-col rounded-t-[16px] border-0 p-0 text-inherit bg-surface pb-[max(env(safe-area-inset-bottom),12px)] shadow-dialog focus:outline-none motion-safe:animate-rise-in"
/** The whole head is the grip: a swipe down on it closes the sheet. */
const HEAD = "flex flex-none touch-none flex-col"
const HANDLE = "mx-auto mt-2 h-1 w-9 rounded-full bg-line-active"
const TITLE = "m-0 px-5 pt-3 pb-2 font-sans text-body font-semibold text-ink"
const LIST = "flex min-h-0 flex-col overflow-y-auto px-3 pb-1"
const ROW =
  "flex min-h-11 w-full flex-none items-center gap-3 rounded-sm px-2 text-left font-sans text-body text-ink active:bg-hover focus-visible:bg-hover focus-visible:outline-none"
const CHECK =
  "ml-auto size-4 flex-none fill-none stroke-accent [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.75]"
/** A swipe down on the head this long closes the sheet. */
const SWIPE_PX = 48

/**
 * A phone's one-of-N picker: rows rising from the bottom edge, the current one checked. A tap outside, Esc or a
 * swipe down on its head closes it without picking.
 */
export function PickSheet<T extends string | number>(props: {
  title: string
  value: T
  picks: readonly { readonly value: T; readonly label: string }[]
  onPick: (next: T) => void
  onClose: () => void
}) {
  const current = useRef<HTMLButtonElement>(null)
  const startY = useRef<number | null>(null)
  useEffect(() => current.current?.focus(), [])
  return createPortal(
    <div
      className={SCRIM}
      onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return
        // Esc closes the sheet alone, not the dialog it opened from.
        e.stopPropagation()
        e.nativeEvent.stopImmediatePropagation()
        props.onClose()
      }}
    >
      <dialog open aria-modal="true" aria-label={props.title} className={PANEL}>
        <div
          className={HEAD}
          onTouchStart={(e) => {
            startY.current = e.touches[0]?.clientY ?? null
          }}
          onTouchEnd={(e) => {
            const from = startY.current
            startY.current = null
            if (from !== null && (e.changedTouches[0]?.clientY ?? from) - from > SWIPE_PX) props.onClose()
          }}
        >
          <span className={HANDLE} aria-hidden="true" />
          <h2 className={TITLE}>{props.title}</h2>
        </div>
        <div className={LIST}>
          {props.picks.map((pick) => {
            const on = pick.value === props.value
            return (
              <button
                type="button"
                key={pick.value}
                ref={on ? current : undefined}
                aria-pressed={on}
                className={ROW}
                onClick={() => {
                  props.onClose()
                  if (!on) props.onPick(pick.value)
                }}
              >
                <span className="min-w-0">{pick.label}</span>
                {on && (
                  <svg viewBox="0 0 16 16" className={CHECK} aria-hidden="true">
                    <path d="M3 8.5 6.5 12 13 4.5" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      </dialog>
    </div>,
    document.body,
  )
}
