/**
 * The phone layout's building blocks. A phone screen composes these; the desktop never renders them, so they carry
 * no `narrow:` variants. Glass and the rounded-square buttons are `glass.ts` and `nav-button.tsx`; sheets `sheet.tsx`.
 */

import { type MouseEvent, type ReactNode, type Ref, useLayoutEffect, useRef, useState } from "react"
import { createStore, useStore } from "../store.ts"
import { PRESS, SQUARE_BAR, glass } from "./glass.ts"
import { haptic } from "./haptic.ts"
import { NavButton, PlusGlyph } from "./nav-button.tsx"

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

/** iOS's grouped list: an optional caption, then the group's rows on one rounded card, a hairline between them. `inset` is the card's ground on a sheet, which is already the surface. */
export function PhoneGroup({ label, inset, children }: { label?: string; inset?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <p className="m-0 px-3 pb-0 font-mono text-meta font-normal text-subtle">{label}</p>}
      <div
        className={`flex flex-col overflow-hidden rounded-[12px] [&>*+*]:[border-top:var(--hairline)_solid_var(--line)] ${inset ? "bg-inset" : "bg-surface"}`}
      >
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
 * controls bottom left (one glass capsule); `wide` is the screen's one action, a bar filling the rest of the row.
 * The content scrolls under it.
 */
export interface PhoneAction {
  readonly label: string
  /** The screen's main action is the accent; the rest are glass. */
  readonly tone?: "accent"
  /** A square that shows this instead of its label (⋯). */
  readonly glyph?: ReactNode
  readonly disabled?: boolean
  readonly onClick: () => void
}

/** A foot's named actions, each the bar's height and shape, the label centred: the accent one last. */
export function PhoneActions({ actions }: { actions: readonly PhoneAction[] }) {
  return (
    <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2.5" data-phone-actions>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          disabled={action.disabled}
          aria-label={action.glyph ? action.label : undefined}
          className={`grid h-13 cursor-pointer place-items-center px-3 font-sans text-body font-semibold disabled:opacity-50 ${SQUARE_BAR} ${PRESS} ${action.glyph ? "w-13 flex-none" : "min-w-0 flex-1"} ${action.tone === "accent" ? "bg-accent text-paper shadow-popover" : `${glass()} text-ink`}`}
          onClick={() => {
            haptic()
            action.onClick()
          }}
        >
          {action.glyph ?? <span className="max-w-full truncate">{action.label}</span>}
        </button>
      ))}
    </div>
  )
}

/** A fact in a `PhoneGroup`: its name, then its value at the right edge (two lines at most). */
export function PhoneFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-13 items-center gap-4 px-3 py-2 font-sans text-body">
      <span className="flex-none text-muted">{label}</span>
      <span className="ml-auto line-clamp-2 min-w-0 text-right wrap-anywhere text-ink">{children}</span>
    </div>
  )
}

/** What a screen puts in the phone's one bottom bar: a capsule bottom left (the list's), then its wide + bar or one named action. */
export interface PhoneBarSpec {
  readonly capsule?: ReactNode
  /** The screen's one action: a glass bar filling the row, its name after an accent +, `note` at its end. */
  readonly wide?: { label: string; note?: string; onClick: () => void }
  /** A named action in place of the + bar (Update). */
  readonly action?: PhoneAction
}

type BarSlot = "list" | "page"
const barSlots = createStore<Readonly<Record<BarSlot, PhoneBarSpec | null>>>({ list: null, page: null })

/** Declares this screen's bottom bar (`null`: none); `PhoneBarHost` draws it. The list and the open page each own a slot. */
export function usePhoneBar(slot: BarSlot, spec: PhoneBarSpec | null): void {
  useLayoutEffect(() => barSlots.set({ ...barSlots.get(), [slot]: spec }))
  useLayoutEffect(() => () => barSlots.set({ ...barSlots.get(), [slot]: null }), [slot])
}

const SLIDE: KeyframeAnimationOptions = { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" }
const MORPH = "duration-220 ease-snap motion-reduce:transition-none"
const contentKey = (spec: PhoneBarSpec): string =>
  spec.wide ? `w${spec.wide.label}\0${spec.wide.note ?? ""}` : `a${spec.action?.label}\0${spec.action?.tone ?? ""}`

function BarContent({ spec }: { spec: PhoneBarSpec }) {
  if (spec.wide)
    return (
      <span className="flex h-full min-w-0 items-center gap-2 px-3.5 font-mono">
        <span className="flex flex-none text-accent">
          <PlusGlyph />
        </span>
        <span className="min-w-0 truncate text-body text-ink lowercase">{spec.wide.label}</span>
        {spec.wide.note && (
          <span className="ml-auto flex-none text-meta tracking-[0.08em] text-muted uppercase">{spec.wide.note}</span>
        )}
      </span>
    )
  const accent = spec.action?.tone === "accent"
  return (
    <span
      className={`grid h-full place-items-center px-3 font-sans text-body font-semibold ${accent ? "text-paper" : "text-ink"}`}
    >
      <span className="max-w-full truncate">{spec.action?.label}</span>
    </span>
  )
}

/**
 * The phone's one floating foot, after iOS's: what the screen does sits where the thumb is, and it stays put while
 * pages push and pop under it. `show` picks whose bar is up. A change morphs: the + bar's glass slides and stretches
 * to its new frame (FLIP on a transform), the contents cross-fade, the capsule fades in or out; with none, the bar
 * sinks away. The content scrolls under it.
 */
export function PhoneBarHost({ show }: { show: BarSlot | null }) {
  const slots = useStore(barSlots)
  const spec = show ? slots[show] : null
  // Hidden, the bar keeps what it last showed, so that sinks away instead of blanking first.
  const last = useRef<PhoneBarSpec | null>(null)
  if (spec) last.current = spec
  const drawn = spec ?? last.current
  const capsule = useRef<ReactNode>(null)
  if (spec?.capsule) capsule.current = spec.capsule
  const main = useRef<HTMLButtonElement>(null)
  const glassLayer = useRef<HTMLSpanElement>(null)
  const content = useRef<HTMLSpanElement>(null)
  const ghost = useRef<HTMLSpanElement>(null)
  const was = useRef<{ rect: DOMRect; key: string; spec: PhoneBarSpec } | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  const [leaving, setLeaving] = useState<{ spec: PhoneBarSpec; left: number; width: number; key: string } | null>(null)
  const key = drawn ? contentKey(drawn) : ""

  useLayoutEffect(() => {
    const el = main.current
    if (!el || !spec) return
    const rect = el.getBoundingClientRect()
    const before = was.current
    was.current = { rect, key, spec }
    // A bar still up morphs from what it showed; one coming back from sunk away just rises. A page mounting after
    // the switch leaves its slot empty for one render, which must not count as gone.
    const up = Number(getComputedStyle(bar.current ?? el).opacity) > 0.5
    if (!before || !up || matchMedia("(prefers-reduced-motion: reduce)").matches) return
    if (before.key !== key)
      setLeaving({ spec: before.spec, left: before.rect.left - rect.left, width: before.rect.width, key: before.key })
    const dx = before.rect.left - rect.left
    const sx = before.rect.width / rect.width
    if (Math.abs(dx) < 0.5 && Math.abs(sx - 1) < 0.005) return
    glassLayer.current?.animate([{ transform: `translateX(${dx}px) scaleX(${sx})` }, { transform: "none" }], SLIDE)
    // The labels ride the glass's left edge.
    content.current?.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], SLIDE)
  })
  useLayoutEffect(() => {
    if (leaving) ghost.current?.animate([{ transform: "none" }, { transform: `translateX(${-leaving.left}px)` }], SLIDE)
  }, [leaving])
  if (!drawn) return null
  const hasCapsule = !!spec?.capsule || (!spec && !!drawn.capsule)
  const accent = drawn.action?.tone === "accent"
  const onPress = drawn.wide?.onClick ?? drawn.action?.onClick
  return (
    <div
      // Alone on a page, the bar meets the cards' edges.
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-2 col-1 row-1 flex items-end gap-2.5 pb-3 transition-[translate,opacity] ${MORPH} ${hasCapsule ? "px-4" : "px-3"} ${spec ? "" : "translate-y-4 opacity-0"}`}
      ref={bar}
      inert={!spec}
      data-bottom-bar
    >
      {capsule.current && (
        <div
          className={`flex-none transition-opacity ${MORPH} ${hasCapsule ? "" : "absolute bottom-3 left-4 opacity-0"}`}
          inert={!hasCapsule}
        >
          {capsule.current}
        </div>
      )}
      <button
        ref={main}
        type="button"
        disabled={drawn.action?.disabled}
        className={`pointer-events-auto relative h-13 min-w-0 flex-1 cursor-pointer disabled:opacity-50 ${PRESS}`}
        data-new-task-bar={drawn.wide ? "" : undefined}
        onClick={() => {
          haptic()
          onPress?.()
        }}
      >
        <span ref={glassLayer} className={`absolute inset-0 origin-left ${SQUARE_BAR} ${glass()}`}>
          <span
            className={`absolute -inset-px ${SQUARE_BAR} bg-accent shadow-popover transition-opacity ${MORPH} ${accent ? "" : "opacity-0"}`}
          />
        </span>
        {leaving && (
          <span
            key={leaving.key}
            ref={ghost}
            aria-hidden="true"
            className="absolute inset-y-0 motion-safe:animate-fade-out motion-reduce:hidden"
            style={{ left: leaving.left, width: leaving.width }}
            onAnimationEnd={() => setLeaving(null)}
          >
            <BarContent spec={leaving.spec} />
          </span>
        )}
        <span key={key} ref={content} className="relative block h-full motion-safe:animate-[fade-in_220ms_ease-out]">
          <BarContent spec={drawn} />
        </span>
      </button>
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
 * content scrolling under the bottom bar, and its one action as that bar. The way back is the session bar's.
 */
export function PhonePage(props: {
  title: string
  note?: ReactNode
  primary?: { label: string; onClick: () => void }
  /** A named action at the foot instead of a +: Update's button. */
  action?: PhoneAction
  rootRef?: Ref<HTMLDivElement>
  children: ReactNode
}) {
  usePhoneBar("page", props.primary ? { wide: props.primary } : props.action ? { action: props.action } : null)
  return (
    <div ref={props.rootRef} tabIndex={-1} className="relative flex min-h-0 flex-1 flex-col focus:outline-none">
      <div className={`${PHONE_LIST} ${props.primary || props.action ? "pb-20" : ""}`}>
        <div className="flex flex-col gap-1">
          <PhoneTitle>{props.title}</PhoneTitle>
          {props.note && <p className="m-0 font-sans text-meta text-muted">{props.note}</p>}
        </div>
        {props.children}
      </div>
    </div>
  )
}
