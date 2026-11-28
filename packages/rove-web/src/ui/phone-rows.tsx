/**
 * The phone's list rows, after the old iPhone app's task list: a mark, two lines, and the status dots. A session row
 * leads with its engine's mark; a routine row ends with its last run's dots.
 */

import type { ComponentProps, MouseEvent, ReactNode } from "react"
import { Chevron } from "./chevron.tsx"
import { CountBadge, GlassButton } from "./nav-button.tsx"

/** In the engine mark's cell, for a routine that runs a command and no engine: a terminal prompt. */
export function ScriptMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="block size-4.5 flex-none translate-y-px fill-none stroke-current text-muted [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.3]"
      aria-hidden="true"
    >
      <path d="M3 3.5h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM4.5 6.5 6.5 8l-2 1.5M8 10h3" />
    </svg>
  )
}

/** The mark drops its 1px optical nudge here: on the row's centre with the title and the dots. */
const ROW =
  "flex min-h-15 w-full items-center gap-3 px-3 py-2 text-left active:bg-hover focus-visible:bg-hover focus-visible:outline-none [&>svg]:translate-y-0"
/** Hidden while empty, so a one-line row's title sits on the row's centre. */
const LINE2 = "flex min-w-0 items-center gap-1.5 font-mono text-[13px] leading-[1.3] text-muted empty:hidden"

/**
 * One row: `mark`, then the title over a muted mono line, then `status` at the right edge, all on the row's centre.
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
    status: ReactNode
  },
) {
  const { lead, mark, title, dim, selected, line2, status, ...rest } = props
  return (
    <button
      type="button"
      className={`${ROW} ${selected ? "bg-menu" : "hover:bg-hover data-menu-open:bg-hover"}`}
      data-phone-row
      {...rest}
    >
      {lead}
      {mark}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`row-title truncate font-sans text-title ${dim ? "text-muted" : "text-ink"}`}>{title}</span>
        <span className={LINE2}>{line2}</span>
      </span>
      {status}
    </button>
  )
}

const HEAD_BUTTON =
  "flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-left text-inherit [font:inherit] hover:text-ink"

/** A group's header: its name in capitals (a tap folds it), then a ⋯ for its actions. */
export function PhoneGroupHead(props: {
  label: string
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
      {props.more && (
        <button
          type="button"
          className="-mr-2 grid size-11 flex-none cursor-pointer place-items-center border-none bg-transparent font-sans text-display text-muted hover:text-ink active:text-ink"
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
