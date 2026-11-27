import { t } from "../i18n/index.ts"
import { useNarrow } from "../layout.ts"
import { PRESS, glass } from "./glass.ts"
import { DIALOG_CLOSE } from "./overlay.ts"

/** A 36px glass disc on a 44px hit area, after iOS's navigation buttons. */
const DISC = `relative grid size-9 flex-none cursor-pointer place-items-center rounded-full text-ink after:absolute after:-inset-1 after:content-[''] ${glass()} ${PRESS}`
const ICON = "size-4 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.75]"
const PATH = { back: "M10 3 5 8l5 5", close: "M4 4l8 8M12 4 4 12" } as const

/** The phone layout's way back or out, top left of a page: a bare chevron (or ×), named by `label` for a screen reader. */
export function NavButton(props: { kind: keyof typeof PATH; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={DISC}
      data-nav={props.kind}
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
    >
      <svg viewBox="0 0 16 16" className={ICON} aria-hidden="true">
        <path d={PATH[props.kind]} />
      </svg>
    </button>
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
