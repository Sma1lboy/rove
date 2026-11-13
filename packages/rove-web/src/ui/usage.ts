/** The Usage page is a statement printed across the page: mono, the theme's own colours, every figure a line item. */

export const USG_PAGE = "mx-auto flex max-w-[76rem] flex-col font-mono text-meta leading-[1.5]"

/** The masthead: wordmark and title left, the barcode right. */
export const USG_TOP = "flex items-end justify-between gap-[4ch]"
export const USG_MARK = "m-0 text-title font-bold tracking-[0.02em]"
export const USG_CAPS = "font-bold tracking-code uppercase"
export const USG_DIM = "text-muted"
export const USG_FAINT = "text-subtle"
/** A dashed tear line between bands. */
export const USG_RULE = "my-4 border-t-hairline border-dashed! border-line-active"
export const USG_HEAD = `m-0 mb-1.5 text-meta text-muted ${USG_CAPS}`
/** A heading with its legend at the far end. */
export const USG_HEAD_SPLIT = `${USG_HEAD} flex flex-wrap items-baseline justify-between gap-x-[4ch]`

/** The total beside the days: the figure keeps its width, the chart takes the rest; they stack when the page is narrow. */
export const USG_LEAD = "flex flex-wrap items-start gap-x-[8ch] gap-y-4"
export const USG_LEAD_CHART = "min-w-[min(100%,36ch)] flex-1"
/** The one big figure. */
export const USG_TOTAL = "text-[3.5rem] leading-none font-bold tracking-[-0.03em]"

/** The lists side by side, as many columns as fit. */
export const USG_COLS = "grid grid-cols-[repeat(auto-fit,minmax(min(100%,34ch),1fr))] items-start gap-x-[6ch] gap-y-5"

/** A line item: name, dotted leader, amount. */
export const USG_LINE = "flex min-w-0 items-baseline gap-[1ch] whitespace-nowrap"
export const USG_NAME = "min-w-0 truncate"
export const USG_LEADER = "min-w-[2ch] flex-1 -translate-y-0.75 border-b-hairline border-dotted! border-line-active"
/** The small print under a line item. */
export const USG_SUB = "pl-[2ch] text-subtle"
export const USG_ITEM = "-mx-[1ch] block rounded-sm px-[1ch] py-0.5 text-left"
/** An item that opens its task. */
export const USG_ITEM_OPEN = `${USG_ITEM} w-[calc(100%+2ch)] cursor-pointer hover:bg-hover focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus`

/** A day: date, bar, tokens, turns, time. */
export const USG_DAY =
  "grid grid-cols-[6ch_minmax(0,1fr)_5ch_5ch_8ch] items-center gap-x-[2ch] py-0.5 whitespace-nowrap"
export const USG_BAR = "flex h-2.5 w-(--fill) min-w-0.5 gap-px"
export const USG_SEG = "min-w-0.5 basis-0"
/** One colour per engine, the busiest first. */
export const USG_ENGINE_TONES = ["bg-accent", "bg-info", "bg-merged", "bg-subtle"] as const
export const USG_LEGEND = "flex flex-wrap gap-x-[2ch] font-normal tracking-normal normal-case"
export const USG_SWATCH = "mr-[1ch] inline-block size-2 align-baseline"

/** A quota window: name, a framed gauge, percent. */
export const USG_QUOTA =
  "grid grid-cols-[minmax(0,1fr)_minmax(8ch,14ch)_5ch] items-center gap-x-[1ch] whitespace-nowrap"
const GAUGE =
  "relative h-2.5 border-hairline border-current after:absolute after:inset-y-0 after:left-0 after:w-(--fill) after:bg-current after:content-['']"
/** The rail's tones: green while healthy, amber near full, red at the limit. */
export const USG_GAUGE: Readonly<Record<string, string>> = {
  ok: `${GAUGE} text-success`,
  warn: `${GAUGE} text-warning`,
  crit: `${GAUGE} text-error`,
}

export const USG_BARCODE = "flex h-9 flex-none items-stretch text-ink"
export const USG_STRIPE = "flex-none bg-current"
export const USG_FOOT = "flex flex-wrap items-baseline justify-between gap-x-[4ch] gap-y-1 text-subtle"
