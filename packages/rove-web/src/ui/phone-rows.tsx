/**
 * The phone's list rows, after the old iPhone app's task list: a status mark, two lines, and a right column
 * (an age over a short name). Session rows and routine rows both draw this, so the two lists read the same.
 */

import { type RowGlyphSet, type RowTone, rowStatusGlyph } from "@sma1lboy/rove/src/lib/row-status-glyph.ts"
import { type ComponentProps, type MouseEvent, type ReactNode, useEffect, useState } from "react"
import type { RowStatus } from "rove-bridge/protocol"
import { reducedMotion } from "../ui.ts"
import { Chevron } from "./chevron.tsx"
import { CountBadge, GlassButton } from "./nav-button.tsx"

const TONE: Readonly<Record<RowTone, string>> = {
  accent: "text-accent",
  warning: "text-warning",
  error: "text-error",
  muted: "text-subtle",
}
/** The mark's cell: one glyph wide, so every row's title starts on one edge. */
export const PHONE_MARK = "w-[1ch] flex-none text-center font-mono text-title leading-none"
const SPINNER_MS = 80

/** A row's daemon status as `row-status-glyph.ts` maps it; the spinner steps only while the row runs. */
export function StatusGlyph({ status, glyphs }: { status: RowStatus | undefined; glyphs: RowGlyphSet }) {
  const [frame, setFrame] = useState(0)
  const mark = rowStatusGlyph(status, glyphs, frame)
  const spins = mark.spinning && !reducedMotion()
  useEffect(() => {
    if (!spins) return
    const timer = window.setInterval(() => setFrame((n) => n + 1), SPINNER_MS)
    return () => window.clearInterval(timer)
  }, [spins])
  return (
    <span className={`${PHONE_MARK} ${TONE[mark.tone]}`} data-status={status?.kind ?? "none"} aria-hidden="true">
      {mark.glyph}
    </span>
  )
}

const ROW =
  "flex min-h-15 w-full items-center gap-3 px-3 py-2 text-left active:bg-hover focus-visible:bg-hover focus-visible:outline-none data-menu-open:bg-hover"
const LINE2 = "flex min-w-0 items-center gap-1.5 font-mono text-[13px] leading-[1.3] text-muted"

/**
 * One two-line row: `mark`, then the title over a muted mono line, then `top` over `bottom` at the right edge.
 * The whole row is one target; a long press opens its menu (`onContextMenu`).
 */
export function PhoneStatusRow(
  props: Omit<ComponentProps<"button">, "className" | "type" | "title"> & {
    /** What comes before the mark: a child row's indent. */
    lead?: ReactNode
    mark: ReactNode
    title: ReactNode
    /** Greyed: a paused routine, a row whose machine is away. */
    dim?: boolean
    selected?: boolean
    line2: ReactNode
    top: string
    bottom?: string | undefined
  },
) {
  const { lead, mark, title, dim, selected, line2, top, bottom, ...rest } = props
  return (
    <button type="button" className={`${ROW} ${selected ? "bg-menu" : ""}`} data-phone-row {...rest}>
      {lead}
      {mark}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`row-title truncate font-sans text-title ${dim ? "text-muted" : "text-ink"}`}>{title}</span>
        <span className={LINE2}>{line2}</span>
      </span>
      <span className="flex flex-none flex-col items-end gap-0.5 font-mono leading-[1.3]">
        <span className="text-[13px] text-muted tabular-nums">{top}</span>
        {bottom && <span className="max-w-24 truncate text-[12px] text-subtle">{bottom}</span>}
      </span>
    </button>
  )
}

const HEAD_BUTTON =
  "flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-left text-inherit [font:inherit]"

/** A group's header: its name in capitals (a tap folds it), then how many rows it holds and a ⋯ for its actions. */
export function PhoneGroupHead(props: {
  label: string
  count: number
  collapsed: boolean
  foldLabel: string
  onToggle: () => void
  /** The ⋯: the group's actions as a sheet. Absent on a group that has none. */
  more?: { label: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void }
}) {
  return (
    <>
      <button
        type="button"
        className={HEAD_BUTTON}
        aria-expanded={!props.collapsed}
        aria-label={props.foldLabel}
        onClick={props.onToggle}
      >
        <span className="truncate tracking-[0.06em] uppercase">{props.label}</span>
        {props.collapsed && <Chevron right />}
      </button>
      <span className="flex-none font-normal tabular-nums" data-group-count>
        {String(props.count).padStart(2, "0")}
      </span>
      {props.more && (
        <button
          type="button"
          className="-mr-2 grid size-11 flex-none cursor-pointer place-items-center border-none bg-transparent font-sans text-display text-muted active:text-ink"
          aria-label={props.more.label}
          data-group-more
          onClick={props.more.onClick}
        >
          ⋯
        </button>
      )}
    </>
  )
}

/** Lucide `blocks` (ISC). */
const BLOCKS = "M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2"

/** Beside the wordmark, left of Extensions: Lucide `clock` (ISC), with a count while routines need you. */
export function RoutinesButton(props: { label: string; count: number; onClick: () => void }) {
  return (
    <GlassButton size="nav" kind="routines" label={props.label} onClick={props.onClick}>
      <svg
        viewBox="0 0 24 24"
        className="size-5.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
      {props.count > 0 && <CountBadge count={props.count} />}
    </GlassButton>
  )
}

/** Beside the wordmark, at the right edge: opens the sheet of pages extensions add. */
export function ExtensionsButton(props: { label: string; onClick: () => void }) {
  return (
    <GlassButton size="nav" kind="extensions" label={props.label} onClick={props.onClick}>
      <svg
        viewBox="0 0 24 24"
        className="size-5.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]"
        aria-hidden="true"
      >
        <path d={BLOCKS} />
        <rect x="14" y="2" width="8" height="8" rx="1" />
      </svg>
    </GlassButton>
  )
}
