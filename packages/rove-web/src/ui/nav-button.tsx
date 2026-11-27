import type { ReactNode } from "react"
import { t } from "../i18n/index.ts"
import { useNarrow } from "../layout.ts"
import { PRESS, SQUARE, SQUARE_BAR, glass } from "./glass.ts"
import { DIALOG_CLOSE } from "./overlay.ts"

/** Literal class names, so Tailwind finds them. `primary` is the bottom bar's height, as the capsule beside it. */
const SIZE = {
  nav: `size-11 ${SQUARE}`,
  primary: `size-13 ${SQUARE_BAR}`,
} as const
const ICON = "fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round]"

/**
 * The phone's rounded-square button, after iOS's: glass for `nav` beside a title; `primary`,
 * the screen's one action, is a solid accent square of the bar's size, like Send, with a shadow and no glass. `label` names it for a screen reader; the caller passes the glyph.
 */
export function GlassButton(props: {
  size: keyof typeof SIZE
  label: string
  onClick: () => void
  kind?: string
  children: ReactNode
}) {
  const primary = props.size === "primary"
  return (
    <button
      type="button"
      className={`pointer-events-auto relative grid flex-none cursor-pointer place-items-center ${SIZE[props.size]} ${primary ? "bg-accent text-paper shadow-popover" : `${glass()} text-ink`} ${PRESS}`}
      data-nav={props.kind}
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

/** One segment of the bar's glass capsule: no glass of its own, the capsule carries it. */
const SEGMENT = `pointer-events-auto relative grid h-full w-13 flex-none cursor-pointer place-items-center text-ink ${PRESS}`

/**
 * Settings and Inbox share one glass capsule bottom left, as related controls do on iOS; a hairline parts the two.
 * The badge sits on the inbox segment's shoulder, the capsule's top right.
 */
export function BarCapsule(props: {
  settings: { label: string; onClick: () => void; glyph: ReactNode }
  inbox: { label: string; onClick: () => void; count: number }
}) {
  return (
    <div
      className={`pointer-events-auto relative flex h-13 flex-none items-center ${SQUARE_BAR} ${glass()}`}
      data-bar-capsule
    >
      <button
        type="button"
        className={SEGMENT}
        aria-label={props.settings.label}
        title={props.settings.label}
        onClick={props.settings.onClick}
      >
        {props.settings.glyph}
      </button>
      <span
        aria-hidden="true"
        className="h-6 w-(--hairline) flex-none bg-[color-mix(in_srgb,var(--ink)_14%,transparent)]"
      />
      <button
        type="button"
        className={SEGMENT}
        data-nav="inbox"
        aria-label={props.inbox.label}
        title={props.inbox.label}
        onClick={props.inbox.onClick}
      >
        <TrayGlyph />
        {props.inbox.count > 0 && <CountBadge count={props.inbox.count} />}
      </button>
    </div>
  )
}

const PATH = { back: "M10 3 5 8l5 5", close: "M4 4l8 8M12 4 4 12" } as const

/** The phone layout's way back or out, top left of a page: a bare chevron (or ×), named by `label`. */
export function NavButton(props: { kind: keyof typeof PATH; label: string; onClick: () => void }) {
  return (
    <GlassButton size="nav" kind={props.kind} label={props.label} onClick={props.onClick}>
      <svg viewBox="0 0 16 16" className={`size-5.5 ${ICON} [stroke-width:1.5]`} aria-hidden="true">
        <path d={PATH[props.kind]} />
      </svg>
    </GlassButton>
  )
}

/** A count on a glass button's shoulder (unread items); the caller hides it at zero. */
function CountBadge({ count }: { count: number }) {
  return (
    <span
      key={count}
      className="absolute -top-1 -right-1.5 z-1 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-accent px-1 font-sans text-[12px] leading-none font-semibold text-paper normal-nums motion-safe:animate-pop"
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}

/** Lucide `inbox` (ISC). */
function TrayGlyph() {
  return (
    <svg viewBox="0 0 24 24" className={`size-5.5 ${ICON} [stroke-width:1.6]`} aria-hidden="true">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  )
}

/** The primary action's +. */
export function PlusGlyph() {
  return (
    <svg viewBox="0 0 16 16" className={`size-5.5 ${ICON} [stroke-width:1.5]`} aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

/** A dialog's ×: the glass square on a phone, the quiet glyph elsewhere. */
export function DialogClose({ onClick }: { onClick: () => void }) {
  const narrow = useNarrow()
  const label = t("dialog.close")
  if (narrow) return <NavButton kind="close" label={label} onClick={onClick} />
  return (
    <button type="button" className={DIALOG_CLOSE} aria-label={label} title={label} onClick={onClick}>
      ×
    </button>
  )
}
