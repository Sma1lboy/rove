import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { reducedMotion } from "../ui.ts"

/** Inside the part of the screen the soft keyboard leaves (`--vvh`), so a sheet with a field rises above it. */
const SCRIM = "fixed inset-x-0 top-0 z-50 flex h-(--vvh,100dvh) items-end bg-[var(--scrim)]"
const PANEL =
  "static m-0 flex max-h-[85dvh] w-full max-w-none flex-col rounded-t-[16px] border-0 p-0 text-inherit bg-surface pb-[max(env(safe-area-inset-bottom),12px)] shadow-dialog focus:outline-none keyboard:max-h-[calc(var(--vvh,100dvh)-24px)] keyboard:pb-3"
/** The whole head is the grip: a swipe down on it closes the sheet. */
const HEAD = "flex flex-none touch-none flex-col"
const HANDLE = "mx-auto mt-2 mb-1 h-1 w-9 rounded-full bg-line-active"
const TITLE = "m-0 px-5 pt-2 pb-2 font-sans text-body font-semibold text-ink"
/** A sheet's list: it scrolls, the head stays. */
export const SHEET_LIST = "flex min-h-0 flex-col overflow-y-auto px-3 pb-1"
const ROW =
  "flex min-h-11 w-full flex-none items-center gap-3 rounded-sm px-2 text-left font-sans text-body active:bg-hover focus-visible:bg-hover focus-visible:outline-none"
const ROW_TONE = {
  ink: "text-ink",
  danger: "text-error",
  /** The way back to the list a sheet came from. */
  muted: "text-muted",
  /** Cancel: last, centred, the one bold row. */
  cancel: "justify-center font-semibold text-ink",
  /** The sheet's own action at its foot (Ack all): centred, in the accent. */
  action: "justify-center font-semibold text-accent",
} as const
/** Between two groups of rows. */
export const SHEET_SEP = "mx-2 my-1 h-px flex-none border-none bg-line"
const CHECK =
  "ml-auto size-4 flex-none fill-none stroke-accent [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.75]"
/** A swipe down on the head this long closes the sheet. */
const SWIPE_PX = 48

/**
 * A phone's sheet: it rises from the bottom edge over a fading scrim and slides back down when it closes. A tap
 * outside, Esc or a swipe down on its head closes it. `children` gets `close`, which plays the slide before `onClose`.
 */
export function Sheet(props: {
  label: string
  /** Shown under the handle; a sheet whose rows say enough leaves it out. */
  title?: string
  onClose: () => void
  children: (close: () => void) => ReactNode
}) {
  const startY = useRef<number | null>(null)
  const panel = useRef<HTMLDialogElement>(null)
  const [leaving, setLeaving] = useState(false)
  const close = () => (reducedMotion() ? props.onClose() : setLeaving(true))
  // Unless a row inside already took it (the current pick), focus moves into the sheet, off the page under it.
  useEffect(() => {
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus()
  }, [])
  return createPortal(
    <div
      className={`${SCRIM} ${leaving ? "pointer-events-none animate-fade-out" : "motion-safe:animate-fade-in"}`}
      onPointerDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return
        // Esc closes the sheet alone, not the dialog it opened from.
        e.stopPropagation()
        e.nativeEvent.stopImmediatePropagation()
        close()
      }}
    >
      <dialog
        ref={panel}
        tabIndex={-1}
        open
        aria-modal="true"
        aria-label={props.label}
        className={`${PANEL} ${leaving ? "animate-sheet-out" : "motion-safe:animate-sheet-in"}`}
        onAnimationEnd={(e) => leaving && e.target === e.currentTarget && props.onClose()}
      >
        <div
          className={HEAD}
          onTouchStart={(e) => {
            startY.current = e.touches[0]?.clientY ?? null
          }}
          onTouchEnd={(e) => {
            const from = startY.current
            startY.current = null
            if (from !== null && (e.changedTouches[0]?.clientY ?? from) - from > SWIPE_PX) close()
          }}
        >
          <span className={HANDLE} aria-hidden="true" />
          {props.title && <h2 className={TITLE}>{props.title}</h2>}
        </div>
        {props.children(close)}
      </dialog>
    </div>,
    document.body,
  )
}

/** One choice or action in a sheet: a full-width 44px row. */
export function SheetRow(
  props: Omit<ComponentProps<"button">, "className" | "type"> & { tone?: keyof typeof ROW_TONE },
) {
  const { tone = "ink", ...rest } = props
  return <button type="button" className={`${ROW} ${ROW_TONE[tone]}`} {...rest} />
}

/** The current pick's mark at a sheet row's end. */
export function SheetCheck() {
  return (
    <svg viewBox="0 0 16 16" className={CHECK} aria-hidden="true">
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  )
}

/** A phone's one-of-N picker: the choices as sheet rows, the current one checked. */
export function PickSheet<T extends string | number>(props: {
  title: string
  value: T
  picks: readonly { readonly value: T; readonly label: string }[]
  onPick: (next: T) => void
  onClose: () => void
}) {
  const current = useRef<HTMLButtonElement>(null)
  useEffect(() => current.current?.focus(), [])
  return (
    <Sheet label={props.title} title={props.title} onClose={props.onClose}>
      {(close) => (
        <div className={SHEET_LIST}>
          {props.picks.map((pick) => {
            const on = pick.value === props.value
            return (
              <SheetRow
                key={pick.value}
                ref={on ? current : undefined}
                aria-pressed={on}
                onClick={() => {
                  close()
                  if (!on) props.onPick(pick.value)
                }}
              >
                <span className="min-w-0">{pick.label}</span>
                {on && <SheetCheck />}
              </SheetRow>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}
