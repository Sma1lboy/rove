/** The Dispatch page's class strings (dispatch-view.tsx): the network map, then the recent history. */

/** A bare font-size: the line height stays the inherited one, as the page's own text. */
const SIZE_META = "text-meta leading-[inherit]"

export const DP_PAGE = "flex flex-col gap-4.5"
/** The map takes whatever height the history leaves; nodes, hub and couriers are placed from its measured size. */
export const DP_STAGE = "relative min-w-0 flex-[1_0_auto] overflow-hidden"
export const DP_WIRES = "absolute inset-0 overflow-visible"

const WIRE = {
  live: "stroke-accent [stroke-dasharray:4_5] animate-dp-flow motion-reduce:animate-none",
  failed: "stroke-error [stroke-dasharray:2_4]",
  idle: "stroke-line",
} as const
export const wireClass = (tone: keyof typeof WIRE): string => `fill-none [stroke-width:1.5] ${WIRE[tone]}`

export const nodeClass = (o: { readonly plain: boolean }): string =>
  `absolute flex h-10.5 min-w-0 flex-col justify-center gap-px rounded-sm border-hairline border-line bg-paper px-2.5 text-left text-ink [font:inherit] ${o.plain ? "cursor-default" : "cursor-pointer hover:bg-hover"}`
export const nodeTitleClass = (stale: boolean): string =>
  `min-w-0 truncate text-body leading-[inherit] ${stale ? "text-subtle" : ""}`
export const NODE_SUB = `min-w-0 truncate ${SIZE_META} text-subtle`

export const hubClass = (live: boolean): string =>
  `absolute flex flex-col items-center justify-center rounded-md border-hairline bg-paper ${live ? "border-accent" : "border-line-active"}`
export const HUB_MARK = "text-title leading-[inherit] font-bold text-ink [&_b]:text-accent"
export const HUB_HOST = `max-w-[calc(100%-16px)] truncate ${SIZE_META} text-muted`
export const HUB_SUB = `${SIZE_META} text-subtle`

/** Another registered machine: its sessions sit inside, its name and state on top. */
export const DP_MACHINE = "absolute rounded-md"
export const machineHeadClass = (stale: boolean): string =>
  `h-7.5 truncate px-2.5 text-meta leading-[30px] ${stale ? "text-subtle" : "text-muted"}`

const POSE: Record<string, string> = { knock: "text-warning", ask: "text-warning", done: "text-success", failed: "text-error" }
/** JetBrains Mono joins `<|` and `|>` into arrows; the courier's limbs are separate strokes. */
export const courierClass = (pose: string): string =>
  `pointer-events-none absolute top-0 left-0 w-6 font-mono text-meta leading-[14px] whitespace-pre [font-variant-ligatures:none] will-change-transform ${POSE[pose] ?? "text-accent"}`
export const DP_EMPTY = `absolute right-0 bottom-2.5 left-0 m-0 text-center ${SIZE_META}`

export const DP_SECTION = "flex flex-col gap-0.5"
export const DP_KICKER = "m-0 mb-1"
export const DP_PAST =
  "grid w-full min-w-0 cursor-pointer grid-cols-[2ch_minmax(0,auto)_minmax(0,1fr)_auto] items-center gap-x-3 rounded-sm border-0 bg-transparent px-2 py-0.75 text-left text-ink [font:inherit] hover:bg-hover touch:py-2.5"
export const DP_ROUTE = `min-w-0 truncate ${SIZE_META}`
export const DP_PROMPT = `min-w-0 truncate ${SIZE_META} font-sans`
export const DP_AGE = SIZE_META

const STATUS: Record<string, string> = { working: "text-accent", asking: "text-warning", failed: "text-error", done: "text-success" }
export const statusClass = (status: string): string => STATUS[status] ?? "text-muted"
