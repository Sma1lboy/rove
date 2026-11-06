/** The Dispatch page's class strings (dispatch-view.tsx): the network map, then the recent history. */

/** A bare font-size: the line height stays the inherited one, as the page's own text. */
const SIZE_META = "text-meta leading-[inherit]"

export const DP_PAGE = "flex flex-col gap-4.5"
/** The map takes whatever height the history leaves; nodes, hub and markers are placed from its measured size. */
export const DP_STAGE = "relative min-w-0 flex-[1_0_auto] overflow-hidden"
export const DP_WIRES = "absolute inset-0 overflow-visible"

/** `live`: a prompt is travelling it; `failed`: one stopped on it; `idle`: just who talks to whom. */
const WIRE = {
  live: "stroke-accent [stroke-width:1.5] [stroke-dasharray:4_5] animate-dp-flow motion-reduce:animate-none",
  failed: "stroke-error [stroke-width:1.5] [stroke-dasharray:2_4]",
  idle: "stroke-line [stroke-width:1]",
} as const
export const wireClass = (tone: keyof typeof WIRE): string => `fill-none ${WIRE[tone]}`
/** A wire's ends are marked with a dot in its own colour. */
const PORT = { live: "fill-accent", failed: "fill-error", idle: "fill-line" } as const
export const portClass = (tone: keyof typeof PORT): string => PORT[tone]

/** No box: the node is its text, flush to the end of its wire; a wash on hover, an amber outline when it needs you. */
export const nodeClass = (o: {
  readonly plain: boolean
  readonly side: "sender" | "target"
  readonly asking: boolean
}): string =>
  `absolute flex h-10.5 min-w-0 flex-col justify-center gap-px rounded-sm border-hairline bg-transparent px-2.5 text-ink [font:inherit] ${o.side === "sender" ? "items-end text-right" : "items-stretch text-left"} ${o.asking ? "border-warning" : "border-transparent"} ${o.plain ? "cursor-default" : "cursor-pointer hover:bg-hover"}`
export const nodeTitleClass = (stale: boolean): string =>
  `min-w-0 max-w-full truncate text-body leading-[inherit] ${stale ? "text-subtle" : ""}`
export const NODE_SUB = `flex min-w-0 max-w-full items-baseline justify-between gap-2 ${SIZE_META} text-subtle`
export const NODE_SUB_LABEL = "min-w-0 truncate"

export const hubClass = "absolute flex flex-col items-center justify-center"
export const HUB_MARK = "text-title leading-[inherit] font-bold text-ink [&_b]:text-accent"
export const HUB_HOST = `max-w-[calc(100%-16px)] truncate ${SIZE_META} text-muted`
export const hubSubClass = (live: boolean): string => `${SIZE_META} ${live ? "text-accent" : "text-subtle"}`

/** Another registered machine: its sessions sit inside, its name and state on top. */
export const DP_MACHINE = "absolute rounded-md"
export const machineHeadClass = (stale: boolean): string =>
  `h-7.5 truncate px-2.5 text-meta leading-[30px] ${stale ? "text-subtle" : "text-muted"}`

const MARK = "pointer-events-none absolute top-0 left-0 w-3 text-center font-mono text-meta leading-3"
/** One small glyph that rides a wire while a prompt is on its way. */
export const FLIGHT = `${MARK} text-accent will-change-transform`
/** Where a failed prompt that never arrived stopped. */
export const STOPPED = `${MARK} text-error`
export const DP_EMPTY = `absolute right-0 left-0 m-0 text-center ${SIZE_META}`

export const DP_SECTION = "flex flex-col gap-0.5"
export const DP_KICKER = "m-0 mb-1"
export const DP_PAST =
  "grid w-full min-w-0 cursor-pointer grid-cols-[2ch_minmax(0,auto)_minmax(0,1fr)_auto] items-center gap-x-3 rounded-sm border-0 border-none bg-transparent px-2 py-0.75 text-left text-ink [font:inherit] hover:bg-hover touch:py-2.5"
/** Beside `.mono`, whose `font:` shorthand resets the line height: a plain size utility keeps that. */
export const DP_ROUTE = "min-w-0 truncate text-meta"
export const DP_PROMPT = `min-w-0 truncate ${SIZE_META} font-sans`
export const DP_AGE = "text-meta"

const STATUS: Record<string, string> = {
  working: "text-accent",
  asking: "text-warning",
  failed: "text-error",
  done: "text-success",
}
export const statusClass = (status: string): string => STATUS[status] ?? "text-muted"
