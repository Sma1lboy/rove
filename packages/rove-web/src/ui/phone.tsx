/**
 * The phone layout's building blocks. A phone screen composes these; the desktop never renders them, so they carry
 * no `narrow:` variants. Glass and the rounded-square buttons are `glass.ts` and `nav-button.tsx`; sheets `sheet.tsx`.
 */

import type { MouseEvent, ReactNode, Ref } from "react"
import { PRESS, SQUARE_BAR, glass } from "./glass.ts"
import { GlassButton, NavButton, PlusGlyph } from "./nav-button.tsx"

const BAR = {
  /** Under a pane's own padding (a task, a page). */
  pane: "flex items-center gap-2.5 px-1",
  /** A screen of its own (Settings). */
  screen: "flex flex-none items-center gap-3 px-3 py-2",
} as const
const BAR_TITLE = {
  /** What is open, in body type: a task's name. */
  name: "min-w-0 flex-1 truncate font-sans text-body font-normal text-ink",
  /** A screen's heading beside its back (a Settings section). */
  heading: "m-0 font-sans text-display font-semibold normal-nums text-ink",
} as const

/** Top left the way back (or out), then what is open, then the screen's own controls at the right. */
export function PhoneBar(props: {
  back: { label: string; onClick: () => void; kind?: "back" | "close" }
  frame?: keyof typeof BAR
  title?: string
  titleKind?: keyof typeof BAR_TITLE
  children?: ReactNode
}) {
  const kind = props.titleKind ?? "name"
  return (
    <div className={BAR[props.frame ?? "pane"]}>
      <NavButton kind={props.back.kind ?? "back"} label={props.back.label} onClick={props.back.onClick} />
      {props.title &&
        (kind === "heading" ? (
          <h1 className={BAR_TITLE.heading}>{props.title}</h1>
        ) : (
          <span className={BAR_TITLE.name}>{props.title}</span>
        ))}
      {props.children}
    </div>
  )
}

/** A screen's scrolling body under its bar: the large title, then groups 16px apart, clear of the bottom bar. */
export const PHONE_LIST = "flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto scrollbar-none px-3 pt-0 pb-8"

/** A screen's large title at the top of its list (iOS's), under the bar. */
export function PhoneTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="m-0 px-0 pb-0.5 font-sans text-[28px] leading-[1.2] font-bold normal-nums text-ink">{children}</h1>
  )
}

/** iOS's grouped list: an optional caption, then the group's rows on one rounded card, a hairline between them. */
export function PhoneGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <p className="m-0 px-3 pb-0 font-mono text-meta font-normal text-subtle">{label}</p>}
      <div className="flex flex-col overflow-hidden rounded-[12px] bg-surface [&>*+*]:[border-top:var(--hairline)_solid_var(--line)]">
        {children}
      </div>
    </div>
  )
}

/** A row of a `PhoneGroup`: 52px, a leading glyph, the label, an optional trailing part. */
export const PHONE_ROW =
  "flex min-h-13 items-center gap-3 rounded-none px-3 py-1.25 text-left font-sans text-title text-ink [&:hover]:bg-hover"

/**
 * The screen's floating foot, after iOS's: what the screen does sits where the thumb is. `children` are the secondary
 * controls bottom left (one glass capsule); `primary` is the one accent square bottom right, or `wide` a bar beside
 * the capsule. The content scrolls under it.
 */
export function BottomBar(props: {
  children?: ReactNode
  primary?: { label: string; onClick: () => void; glyph?: ReactNode }
  /** The list's own action in place of the square: a glass bar filling the row, its name after an accent +, `note` at its end. */
  wide?: { label: string; note: string; onClick: () => void }
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-2 flex items-end justify-between gap-2.5 px-4 pb-3"
      data-bottom-bar
    >
      {props.children ?? <span />}
      {props.wide && (
        <button
          type="button"
          className={`pointer-events-auto flex h-13 min-w-0 flex-1 cursor-pointer items-center gap-2 px-3.5 font-mono ${SQUARE_BAR} ${glass()} ${PRESS}`}
          data-new-task-bar
          onClick={props.wide.onClick}
        >
          <span className="flex flex-none text-accent">
            <PlusGlyph />
          </span>
          <span className="min-w-0 truncate text-body text-ink lowercase">{props.wide.label}</span>
          <span className="ml-auto flex-none text-meta tracking-[0.08em] text-muted uppercase">{props.wide.note}</span>
        </button>
      )}
      {props.primary && (
        <GlassButton size="primary" label={props.primary.label} onClick={props.primary.onClick}>
          {props.primary.glyph ?? <PlusGlyph />}
        </GlassButton>
      )}
    </div>
  )
}

/**
 * A phone list's two-line row, at least 52px: the title and a short trailing part (a status, an age) on the first
 * line, a muted line under them. The whole row is one target; a long press opens its menu (`onContextMenu`).
 */
export function PhoneListRow(props: {
  title: string
  trailing?: ReactNode
  subtitle?: string
  onClick: () => void
  onContextMenu?: (e: MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      className="flex min-h-13 w-full flex-col justify-center gap-0.5 px-3 py-2 text-left active:bg-hover focus-visible:bg-hover focus-visible:outline-none"
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
    >
      <span className="flex w-full min-w-0 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate font-sans text-body text-ink">{props.title}</span>
        {props.trailing}
      </span>
      {props.subtitle && <span className="w-full truncate font-sans text-meta text-muted">{props.subtitle}</span>}
    </button>
  )
}

/**
 * A page on a phone (Routines, Kanban, Issues, Update): the large title, a muted line of status under it, the page's
 * content scrolling under the bottom bar, and its one action as the bar's accent +. The way back is the session bar's.
 */
export function PhonePage(props: {
  title: string
  note?: ReactNode
  primary?: { label: string; onClick: () => void }
  /** Actions that stay at the foot instead of a +: Update's buttons. */
  foot?: ReactNode
  rootRef?: Ref<HTMLDivElement>
  children: ReactNode
}) {
  return (
    <div ref={props.rootRef} tabIndex={-1} className="relative flex min-h-0 flex-1 flex-col focus:outline-none">
      <div className={`${PHONE_LIST} ${props.primary ? "pb-20" : ""}`}>
        <div className="flex flex-col gap-1">
          <PhoneTitle>{props.title}</PhoneTitle>
          {props.note && <p className="m-0 font-sans text-meta text-muted">{props.note}</p>}
        </div>
        {props.children}
      </div>
      {props.foot && <div className="flex-none px-4 pt-2 pb-3">{props.foot}</div>}
      {props.primary && <BottomBar primary={props.primary} />}
    </div>
  )
}
