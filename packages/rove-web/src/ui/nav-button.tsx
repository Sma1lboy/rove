import type { ReactNode } from "react"
import { t } from "../i18n/index.ts"
import { useNarrow } from "../layout.ts"
import { PRESS, glass } from "./glass.ts"
import { DIALOG_CLOSE } from "./overlay.ts"

/** Literal class names, so Tailwind finds them. The 36px disc grows its hit area to 44px. */
const SIZE = {
  nav: "size-9 after:absolute after:-inset-1 after:content-['']",
  bar: "size-11",
  primary: "size-14",
} as const
const ICON = "fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round]"

/**
 * The phone's round glass button, after iOS's: `nav` beside a title, `bar` in a floating bottom bar, `primary` the
 * screen's one accent-tinted action. `label` names it for a screen reader; the caller passes the glyph.
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
      className={`pointer-events-auto relative grid flex-none cursor-pointer place-items-center rounded-full ${SIZE[props.size]} ${primary ? `${glass("primary")} text-accent` : `${glass()} text-ink`} ${PRESS}`}
      data-nav={props.kind}
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

const PATH = { back: "M10 3 5 8l5 5", close: "M4 4l8 8M12 4 4 12" } as const

/** The phone layout's way back or out, top left of a page: a bare chevron (or ×), named by `label`. */
export function NavButton(props: { kind: keyof typeof PATH; label: string; onClick: () => void }) {
  return (
    <GlassButton size="nav" kind={props.kind} label={props.label} onClick={props.onClick}>
      <svg viewBox="0 0 16 16" className={`size-4 ${ICON} [stroke-width:1.75]`} aria-hidden="true">
        <path d={PATH[props.kind]} />
      </svg>
    </GlassButton>
  )
}

/** The primary action's +. */
export function PlusGlyph() {
  return (
    <svg viewBox="0 0 16 16" className={`size-6 ${ICON} [stroke-width:1.5]`} aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

/** A dialog's ×: the glass disc on a phone, the quiet glyph elsewhere. */
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
