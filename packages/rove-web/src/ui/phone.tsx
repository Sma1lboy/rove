/**
 * The phone layout's building blocks. A phone screen composes these; the desktop never renders them, so they carry
 * no `narrow:` variants. Glass and the rounded-square buttons are `glass.ts` and `nav-button.tsx`; sheets `sheet.tsx`.
 */

import { type MouseEvent, type ReactNode, type Ref, useLayoutEffect, useRef, useState } from "react"
import { createStore, useStore } from "../store.ts"
import { GLASS_HOVER, GLASS_HOVER_IN, PRESS, SQUARE_BAR, glass } from "./glass.ts"
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
  "flex min-h-13 items-center gap-3 rounded-none px-3 py-1.25 text-left font-sans text-title text-ink hover:bg-hover"

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
          className={`grid h-13 cursor-pointer place-items-center px-3 font-sans text-body font-semibold disabled:opacity-50 ${SQUARE_BAR} ${GLASS_HOVER} ${PRESS} ${action.glyph ? "w-13 flex-none" : "min-w-0 flex-1"} ${action.tone === "accent" ? "bg-accent text-paper shadow-popover" : `${glass()} text-ink`}`}
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

const SINK = "duration-220 ease-snap motion-reduce:transition-none"
const FADE_OUT_MS = 80
const MELT_MS = 300
const FADE_IN_MS = 120
/** The bar's corner radius: two blobs lapped this far hide their corners in each other. */
const LAP_PX = 14
/** Under this blur two blobs bridge once they are closer than ~8px: apart at the bar's 10px gap, a neck just inside it. */
const GOO_BLUR = 6
/** The goo rounds a corner further: a blob this square comes out at the bar's own radius. */
const BLOB = "rounded-[10px]"
const contentKey = (spec: PhoneBarSpec): string =>
  `${spec.capsule ? "c" : ""}${spec.wide ? `w${spec.wide.label}\0${spec.wide.note ?? ""}` : `a${spec.action?.label}\0${spec.action?.tone ?? ""}`}`

interface Span {
  left: number
  width: number
}
interface BarFrame {
  capsule: Span | null
  main: Span
}
const gapCentre = (f: BarFrame): number | null =>
  f.capsule ? (f.capsule.left + f.capsule.width + f.main.left) / 2 : null

/** The bar's outline as two blobs: the capsule and the bar, or the one bar cut at `seam` with the halves lapped. */
export const barBlobs = (f: BarFrame, seam: number): [Span, Span] =>
  f.capsule
    ? [f.capsule, f.main]
    : [
        { left: f.main.left, width: seam + LAP_PX - f.main.left },
        { left: seam - LAP_PX, width: f.main.left + f.main.width - seam + LAP_PX },
      ]

const span = (el: HTMLElement): Span => ({ left: el.offsetLeft, width: el.offsetWidth })
const frameOf = (capsule: HTMLElement | null, main: HTMLElement): BarFrame => ({
  capsule: capsule && span(capsule),
  main: span(main),
})
/** What fades: the labels and the capsule's buttons, not the glass under them. */
const contentsOf = (capsule: HTMLElement | null, content: HTMLElement | null): Element[] =>
  [content, ...(capsule?.firstElementChild?.children ?? [])].filter((el) => !!el)

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
 * pages push and pop under it. `show` picks whose bar is up; the bar follows only once the page has landed. A change
 * runs in turn, never two labels at once: the old contents fade, the glass melts to its new outline (two pieces
 * flow into one through a neck, one splits in two), the new contents fade in. With none, the bar sinks away.
 */
export function PhoneBarHost({ show }: { show: BarSlot | null }) {
  const slots = useStore(barSlots)
  const bar = useRef<HTMLDivElement>(null)
  const [slot, setSlot] = useState(show)
  useLayoutEffect(() => {
    if (show === slot) return
    let live = true
    // A page with no bar lets it sink as the page comes in: left up, it would lie over the page's own foot.
    const panel = show && barSlots.get()[show] ? bar.current?.parentElement?.querySelector(":scope > main") : null
    const landed = (panel?.getAnimations() ?? []).map((a) => a.finished)
    Promise.allSettled(landed).then(() => live && setSlot(show))
    return () => {
      live = false
    }
  }, [show, slot])

  const want = slot ? slots[slot] : null
  const wantKey = want ? contentKey(want) : null
  // What the bar draws: the wanted bar once the melt reaches it, and its last one while sunk away.
  const [key, setKey] = useState(wantKey)
  const keep = useRef<PhoneBarSpec | null>(null)
  const next = useRef<PhoneBarSpec | null>(null)
  if (want) next.current = want
  if (want && wantKey === key) keep.current = want
  const drawn = keep.current
  const capsule = useRef<HTMLDivElement>(null)
  const main = useRef<HTMLButtonElement>(null)
  const content = useRef<HTMLSpanElement>(null)
  const goo = useRef<HTMLSpanElement>(null)
  const blur = useRef<HTMLSpanElement>(null)
  const busy = useRef(false)
  /** The outline the melt starts from, while it runs. */
  const [from, setFrom] = useState<BarFrame | null>(null)
  const melted = useRef(false)

  useLayoutEffect(() => {
    if (!want || wantKey === key || busy.current) return
    const swap = () => {
      keep.current = next.current
      setKey(next.current ? contentKey(next.current) : null)
    }
    // A bar coming back from sunk away just rises with its new contents.
    const up = bar.current && Number(getComputedStyle(bar.current).opacity) > 0.5
    if (!up || matchMedia("(prefers-reduced-motion: reduce)").matches) return swap()
    busy.current = true
    const fades = contentsOf(capsule.current, content.current).map(
      (el) => el.animate({ opacity: [1, 0] }, { duration: FADE_OUT_MS, fill: "forwards" }).finished,
    )
    Promise.allSettled(fades).then(() => {
      if (main.current) setFrom(frameOf(capsule.current, main.current))
      else busy.current = false
      swap()
    })
  })
  useLayoutEffect(() => {
    if (!from) {
      if (melted.current)
        for (const el of contentsOf(capsule.current, content.current))
          el.animate({ opacity: [0, 1] }, { duration: FADE_IN_MS, easing: "ease-out" })
      melted.current = false
      return
    }
    melted.current = true
    const to = frameOf(capsule.current, main.current as HTMLElement)
    const seam = gapCentre(from) ?? gapCentre(to) ?? to.main.left + to.main.width / 2
    const a = barBlobs(from, seam)
    const b = barBlobs(to, seam)
    const still = a.every((s, i) => s.left === b[i].left && s.width === b[i].width)
    const left = Math.min(a[0].left, b[0].left)
    const right = Math.max(a[1].left + a[1].width, b[1].left + b[1].width)
    blur.current?.style.setProperty("left", `${left}px`)
    blur.current?.style.setProperty("width", `${right - left}px`)
    const moves = Array.from(goo.current?.children ?? [], (el, i) => {
      const blob = el as HTMLElement
      blob.style.left = `${b[i].left}px`
      blob.style.width = `${b[i].width}px`
      return blob.animate(
        [
          { transform: `translateX(${a[i].left - b[i].left}px) scaleX(${a[i].width / b[i].width})` },
          { transform: "none" },
        ],
        { duration: still ? 0 : MELT_MS, easing: "cubic-bezier(0.45, 0, 0.3, 1)" },
      ).finished
    })
    Promise.allSettled(moves).then(() => {
      busy.current = false
      setFrom(null)
    })
  }, [from])

  if (!drawn) return null
  const accent = drawn.action?.tone === "accent"
  const onPress = drawn.wide?.onClick ?? drawn.action?.onClick
  const piece = from ? "invisible" : ""
  return (
    <div
      // Alone on a page, the bar meets the cards' edges.
      className={`pointer-events-none absolute inset-x-0 bottom-0 z-2 col-1 row-1 flex items-end gap-2.5 pb-3 transition-[translate,opacity] ${SINK} ${drawn.capsule ? "px-4" : "px-3"} ${want ? "" : "translate-y-4 opacity-0"}`}
      ref={bar}
      inert={!want}
      data-bottom-bar
    >
      {from && (
        // The melt: the outline as solid blobs under a goo filter (blur, then an alpha threshold), which bridges
        // blobs that come close. A filter cannot carry the glass's backdrop blur, so that sits behind, and only
        // for the melt: at rest the bar is the crisp glass.
        <span aria-hidden="true" className="absolute inset-0" data-bar-melt>
          <span
            ref={blur}
            className={`absolute bottom-3 h-13 backdrop-blur-md backdrop-saturate-150 opaque:hidden ${SQUARE_BAR}`}
          />
          <span
            ref={goo}
            className={`absolute inset-0 [filter:url(#phone-bar-goo)] ${accent ? "" : "opacity-60 opaque:opacity-100"}`}
          >
            <span className={`absolute bottom-3 h-13 origin-left bg-inset ${BLOB}`} />
            <span className={`absolute bottom-3 h-13 origin-left ${BLOB} ${accent ? "bg-accent" : "bg-inset"}`} />
          </span>
          <svg className="absolute size-0" role="presentation">
            <filter id="phone-bar-goo" x="-10%" y="-50%" width="120%" height="200%" colorInterpolationFilters="sRGB">
              <feGaussianBlur in="SourceGraphic" stdDeviation={GOO_BLUR} />
              <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9.5" result="shape" />
              {/* The glass's hairline edge, around the melted outline. */}
              <feMorphology in="shape" operator="erode" radius="1" result="inner" />
              <feFlood floodColor="var(--ink)" floodOpacity="0.12" />
              <feComposite in2="shape" operator="in" />
              <feComposite in2="inner" operator="out" result="rim" />
              {/* Its soft shadow, outside the outline only: the fill is see-through. */}
              <feGaussianBlur in="shape" stdDeviation="4" />
              <feOffset dy="2" />
              <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.4 0" />
              <feComposite in2="shape" operator="out" result="shadow" />
              <feMerge>
                <feMergeNode in="shadow" />
                <feMergeNode in="shape" />
                <feMergeNode in="rim" />
              </feMerge>
            </filter>
          </svg>
        </span>
      )}
      {drawn.capsule && (
        <div key={key} ref={capsule} className={`flex-none ${piece}`}>
          {drawn.capsule}
        </div>
      )}
      <button
        ref={main}
        type="button"
        disabled={drawn.action?.disabled}
        className={`group/glass pointer-events-auto relative h-13 min-w-0 flex-1 cursor-pointer disabled:opacity-50 ${PRESS} ${piece}`}
        data-new-task-bar={drawn.wide ? "" : undefined}
        onClick={() => {
          haptic()
          onPress?.()
        }}
      >
        <span
          className={`absolute inset-0 ${SQUARE_BAR} ${GLASS_HOVER_IN} ${accent ? "bg-accent shadow-popover" : glass()}`}
        />
        <span key={key} ref={content} className="relative block h-full">
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
      className="flex min-h-13 w-full flex-col justify-center gap-0.5 px-3 py-2 text-left hover:bg-hover active:bg-hover focus-visible:bg-hover focus-visible:outline-none"
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
