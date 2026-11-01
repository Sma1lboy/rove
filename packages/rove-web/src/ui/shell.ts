/** Class recipes for the page shell: the app grid, the narrow bar, splits, terminal chrome, the key guide, palette and help. */

/** Only the size, for lines outside a `.mono` element: they keep the line height they inherit. */
const META = "text-meta leading-[inherit]"
/** What the sheets' `font: <size> <family>` shorthand reset besides size and family. */
const FONT_RESET = "font-normal normal-nums"
/** A small control's invisible fingertip-sized hit area. */
const HIT = "touch:relative touch:after:absolute touch:after:content-['']"

export const APP_SHELL = "flex h-full flex-col"

/** `app` and its `is-*` states stay as hooks: the layout variants in tailwind.css read them. */
export const appClass = (o: {
  zen: boolean
  expanded: boolean
  surface: string | null
  folded: boolean
  peek: boolean
  dragging: boolean
}): string =>
  [
    "app relative grid min-h-0 flex-1 grid-rows-[1fr_auto] transition-[grid-template-columns] duration-220 ease-snap motion-reduce:transition-none",
    o.surface
      ? `is-narrow narrow-${o.surface} grid-cols-[minmax(0,1fr)]`
      : o.zen
        ? "grid-cols-[var(--rail-w,minmax(220px,280px))_1fr]"
        : "grid-cols-[var(--rail-w,minmax(220px,280px))_1fr_var(--panel-w,clamp(300px,28vw,440px))]",
    o.zen ? "is-zen" : "",
    o.expanded ? "is-panel-expanded" : "",
    o.folded ? "is-rail-folded" : "",
    o.peek ? "is-rail-peek" : "",
    o.dragging ? "is-dragging transition-none" : "",
  ].join(" ")

/** Folded, the page's left edge that brings the rail back. */
export const RAIL_PEEK_EDGE = "absolute inset-y-0 left-0 z-5 col-1 row-1 w-2.5"

/**
 * The rail's place in the page. Open, its contents keep the open width so folding slides them out; folded, it waits off
 * the left edge as a floating card that a hover slides in (Claude Desktop's folded sidebar).
 */
export const RAIL_FRAME = [
  "relative narrow-content:hidden touch:select-none touch:touch-callout-none",
  "wide:overflow-x-clip wide:pt-8.5 wide:[&>:not([data-grip])]:min-w-(--rail-open-w)",
  "rail-folded:absolute rail-folded:inset-y-1.5 rail-folded:left-1.5 rail-folded:z-6 rail-folded:col-1 rail-folded:row-1 rail-folded:box-border rail-folded:w-(--rail-open-w) rail-folded:-translate-x-[calc(100%+12px)] rail-folded:rounded-md rail-folded:border-hairline rail-folded:border-line rail-folded:bg-surface rail-folded:shadow-none rail-folded:transition-[translate] rail-folded:duration-200 rail-folded:ease-snap rail-folded:motion-reduce:transition-none rail-folded:[&>:not([data-grip])]:min-w-0",
  "rail-peek:translate-none rail-peek:shadow-dialog",
].join(" ")

/** Out of flow, the folded rail no longer claims column 1. Expanded, the panel spans the terminal's column, which keeps its size underneath. */
export const WORKSPACE_FRAME = "rail-folded:col-2 panel-expanded:invisible panel-expanded:col-2 narrow-sidebar:hidden"
export const SIDE_PANEL_FRAME =
  "rail-folded:col-3 panel-expanded:z-2 panel-expanded:col-[2/-1] panel-expanded:bg-paper panel-expanded:pl-2"

/** The rail head's chips: a fingertip target on touch. */
export const HEAD_CHIP = `${HIT} touch:after:-inset-x-1.5 touch:after:-inset-y-3`

/** Narrow layout, content panel: back to the list, and the terminal/panel switch. */
export const NARROW_BAR = "flex items-center gap-2"
export const NARROW_BACK = `px-1.5 py-0.5 text-meta font-bold ${HIT} touch:after:-inset-2.5 touch:after:-bottom-1`
export const NARROW_SWITCH = "ml-auto flex gap-0.5"
export const NARROW_TAB = `rounded-sm px-2.5 py-1 font-mono text-meta font-semibold normal-nums text-muted aria-selected:bg-inset aria-selected:text-ink ${HIT} touch:after:-inset-x-px touch:after:-top-2 touch:after:-bottom-1.5`

export const HINT_BAR =
  "inline-flex shrink-0 items-baseline gap-3 whitespace-nowrap text-meta text-muted *:relative [&_.link:disabled]:cursor-default [&_.link:disabled]:opacity-50"
export const PANE_HINT = "keys-only m-0 overflow-hidden px-3.5 py-1 text-meta text-ellipsis whitespace-nowrap"

/** A chord's keycap badge; under the rail head it hangs below its chip. */
export const shortcutBadge = (head: boolean): string =>
  `shortcut-badge absolute z-8 cursor-pointer rounded-sm border-hairline border-accent bg-surface px-1.25 py-px text-meta text-accent ${head ? "top-full right-0" : "top-1/2 right-1 -translate-y-1/2"}`

/** Split border styles (TUI `SplitStyle`): box frames every pane, line draws only the shared edge, rail a left bar, rule a top rule with the name riding it. */
export const SPLIT = "relative min-w-0 flex-1"
// Literal class names, so Tailwind finds them.
const EDGE = {
  left: ["[border-left:var(--hairline)_solid_var(--line)]", "[border-left:var(--hairline)_solid_var(--accent)]"],
  top: ["[border-top:var(--hairline)_solid_var(--line)]", "[border-top:var(--hairline)_solid_var(--accent)]"],
} as const
const edge = (side: "left" | "top", active: boolean): string => EDGE[side][active ? 1 : 0]
export const splitLeafClass = (style: string | null, o: { left: boolean; top: boolean; active: boolean }): string => {
  // `split-leaf` and `is-active` stay: pane-focus.ts finds the active pane by them.
  const base = `split-leaf absolute box-border flex min-h-0 min-w-0 ${o.active ? "is-active" : ""}`
  const lit = o.active ? "border-accent" : ""
  if (style === "box")
    return `${base} rounded-[calc(var(--radius)-1px)] border-hairline ${o.active ? "border-accent" : "border-line"}`
  if (style === "line")
    return `${base} ${o.left ? edge("left", o.active) : ""} ${o.top ? edge("top", o.active) : ""} ${o.left || o.top ? lit : ""}`
  if (style === "rail") return `${base} ${edge("left", o.active)} ${lit} ${o.top ? "[--mt:6px]" : ""}`
  if (style === "rule") return `${base} ${edge("top", o.active)} ${lit} ${o.left ? "[--ml:8px]" : ""}`
  return base
}
/** The label takes the pointer so a right click on it opens the pane's menu; the terminal under the rest keeps its own. */
export const splitName = (rule: boolean, active: boolean): string =>
  `absolute right-2 z-3 bg-paper px-1 font-mono text-meta ${FONT_RESET} ${rule ? "-top-2" : "top-0.5"} ${active ? "text-accent" : "text-subtle"}`

/** Overlays on the terminal; on touch they clear the key row. */
export const TERM_SCROLLED =
  "absolute right-2.5 bottom-2.5 z-4 flex gap-3 rounded-sm border-hairline border-line bg-inset px-2.5 py-1 text-meta touch:bottom-12"
export const TERM_SEARCH = `absolute inset-x-2 bottom-2 z-5 flex items-center gap-2.5 rounded-sm border-hairline border-line bg-surface px-2.5 py-1 font-mono text-meta ${FONT_RESET} touch:bottom-12 touch:text-display`
export const TERM_SEARCH_INPUT = "min-w-0 flex-1 border-none bg-transparent text-ink [font:inherit] outline-none"
export const TERM_NOTICE_TOUCH = "touch:bottom-12"

/** What a soft keyboard lacks; touch screens only. A narrower column keeps each label whole, then scrolls the row. */
export const TERM_KEY_ROW =
  "hidden gap-1 overflow-x-auto scrollbar-none [border-top:var(--hairline)_solid_var(--line)] bg-surface px-1.5 py-1 touch:flex"
export const termKey = (on: boolean): string =>
  `h-8 min-w-max touch-manipulation [flex:1_1_0] rounded-[6px] border-hairline bg-inset px-0.5 py-0 font-mono text-meta ${FONT_RESET} ${on ? "border-accent text-accent" : "border-line text-ink"}`

/** The which-key map, above the rail's last row so that row's keycap badge stays clickable. */
/** `prefix-guide` stays: leave.ts copies it into a ghost that sinks out, and prefix.tsx keeps clicks on it from cancelling the prefix. */
export const PREFIX_GUIDE =
  "prefix-guide fixed bottom-19 left-3 z-40 max-h-[60vh] w-[min(560px,calc(100vw-24px))] overflow-y-auto rounded-sm border-hairline border-line bg-surface px-3 py-2 text-meta shadow-popover motion-safe:animate-rise-in [&.is-leaving]:pointer-events-none [&.is-leaving]:animate-sink-out"
export const PREFIX_KEY = "min-w-[3ch] text-accent"
export const PREFIX_GUIDE_HEAD = "mb-1.5 flex justify-between gap-4"
export const PREFIX_GUIDE_BODY = "columns-[2_220px] gap-x-5"
export const PREFIX_GUIDE_GROUP = "mb-2 break-inside-avoid"
/** Picker rows grow by padding on touch, so baseline-aligned label and key stay aligned. */
export const PREFIX_GUIDE_ROW =
  "flex w-full gap-2.5 px-0 py-px text-left text-ink enabled:hover:bg-hover disabled:cursor-default touch:py-2.5"

export const PALETTE_LIST = "mx-0 my-2 overflow-y-auto"
export const paletteRow = (selected: boolean): string =>
  `flex w-full justify-between gap-4 rounded-sm px-1.5 py-0.75 text-left font-mono text-meta ${FONT_RESET} whitespace-pre text-ink touch:py-2.5 ${selected ? "is-selected bg-hover" : ""}`

export const HELP_HEAD = "flex justify-between gap-4"
export const HELP_CORNER = `flex flex-col items-end ${META}`
export const HELP_SCROLL = "mt-2 max-h-[52vh] overflow-y-auto"
export const HELP_SECTION = "mb-2.5"
export const HELP_TITLE = "m-0 mb-1 font-sans text-meta font-bold normal-nums text-accent"
export const HELP_ROW = `flex gap-3 py-px ${META}`
export const HELP_CAP = "min-w-[14ch] text-ink"

/** Daemon out-of-date banner (TUI VersionSkewBanner). */
export const DAEMON_BANNER =
  "flex flex-wrap items-baseline gap-3 [border-bottom:var(--hairline)_solid_var(--warning)] bg-inset px-3.5 py-1 text-meta text-warning [&_span]:text-muted"

/** The prefix HUD, bottom-left over the rail as the TUI's. */
export const PREFIX_HUD = `keys-only fixed bottom-[34px] left-3 z-40 min-w-55 rounded-sm border-hairline border-line bg-surface px-3 py-2 font-mono text-meta ${FONT_RESET} text-ink shadow-popover`
/** A HUD line rises in, then sinks out at `--hud-out`; one brought back after the guide only sinks. */
export const prefixHudLine = (back: boolean): string =>
  `mb-0.5 ${back ? "motion-safe:[animation:sink-out_140ms_ease-in_var(--hud-out,3860ms)_forwards]" : "motion-safe:[animation:rise-in_140ms_ease-out,sink-out_140ms_ease-in_var(--hud-out,3860ms)_forwards]"}`

/** The workspace's empty states. */
export const PLACEHOLDER = `m-auto font-mono text-meta ${FONT_RESET} text-subtle`
export const PLACEHOLDER_BOX = `${PLACEHOLDER} flex flex-col items-center gap-3 [&_p]:m-0`

/** The content column: the workspace's top bar over its pane (`workspace` stays: pane-focus.ts and commands.ts find it). */
export const WORKSPACE = "workspace row-1 flex min-h-0 min-w-0 flex-col gap-1.5 px-1 pt-2 pb-1"
/** `pane` stays: settings.css marks its focus and the working border on it. */
export const PANE = "pane flex min-h-0 flex-1 overflow-hidden rounded-md border-hairline border-line bg-paper"

export const TERM_PANE = "relative flex min-w-0 flex-1 flex-col"
/** No padding: the fit addon sizes the grid from this box minus `.xterm`'s padding (styles.css), not its own. `term-host` stays for those xterm rules. */
export const TERM_HOST = "term-host relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden"
/** Kitty placeholder images, over xterm's canvas and under its decorations. */
export const TERM_IMAGES = "pointer-events-none absolute inset-0 z-5 h-full w-full"
/** The terminal's own box (term-pool.ts); a leaving one is held over its successor until that one has painted. */
export const TERM_BOX =
  "relative h-full [&.is-leaving]:pointer-events-none [&.is-leaving]:absolute [&.is-leaving]:inset-0 [&.is-leaving]:z-6"
/** A reattaching terminal's last screen, in the xterm's own grid metrics. */
export const TERM_SNAPSHOT =
  "pointer-events-none absolute inset-0 z-1 overflow-hidden pt-1.5 pr-1 pb-1 pl-2 [&_pre]:m-0 [&_pre>div>div]:overflow-hidden [&_pre>div>div]:[height:var(--row-h,1.15em)] [&_pre>div>div]:[line-height:var(--row-h,1.15em)]"
export const termNotice = (error: boolean): string =>
  `absolute right-2.5 bottom-2.5 z-5 flex items-center gap-3 rounded-sm border-hairline border-line bg-inset px-2.5 py-1.25 font-mono text-meta ${FONT_RESET} ${error ? "text-error" : "text-muted"} [&_.link:disabled]:pointer-events-none [&_.link:disabled]:opacity-60`

/** The footer: usage left, key hints right. `status` stays for the touch block's link inset in styles.css. */
export const STATUS_BAR = `status col-span-full flex min-w-0 items-center gap-2 [border-top:var(--hairline)_solid_var(--line)] bg-surface px-3 py-1 font-mono text-meta ${FONT_RESET} whitespace-nowrap text-muted`
export const connDot = (retrying: boolean): string => `size-1.5 rounded-full ${retrying ? "bg-warning" : "bg-subtle"}`

/** The usage half takes the footer's spare width; usage-view.tsx measures it to pick the full or compact form. */
export const USAGE = "flex min-w-0 flex-[1_1_0] gap-4 overflow-hidden whitespace-nowrap"
/** Gap of 2 TUI cells between a chip's parts; tone only on the percent. */
export const USAGE_CHIP = "[&>span:nth-child(n+3)]:ml-2"
export const USAGE_TONE: Readonly<Record<string, string>> = {
  ok: "text-success",
  warn: "text-warning",
  crit: "text-error",
}
/** A window's fill beside its percent, in the percent's tone; the track is the same tone, faint. */
export const usageBar = (tone: string): string =>
  `relative mx-1.25 mt-0 mb-px inline-block h-1 w-7 overflow-hidden rounded-[2px] bg-[color-mix(in_srgb,currentColor_20%,transparent)] align-middle after:absolute after:inset-y-0 after:left-0 after:w-(--fill) after:bg-current after:content-[''] ${USAGE_TONE[tone] ?? ""}`

export const WORDMARK = "font-mono text-title font-bold normal-nums tracking-[0.02em] whitespace-nowrap"
export const BRACKET = "text-accent"

/** The connect and login screens. */
export const CONNECT = "grid h-full place-items-center p-6"
export const CONNECT_CARD =
  "flex w-[min(460px,100%)] flex-col gap-3 rounded-md border-hairline border-line bg-surface p-6 [&_p]:m-0"

/** A task on another machine: the pane says where it lives. */
export const REMOTE_NOTICE = `flex flex-col gap-2 p-3.5 text-left font-sans text-meta ${FONT_RESET} leading-[1.5]`
