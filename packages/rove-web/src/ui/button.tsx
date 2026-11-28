import type { ComponentProps } from "react"
import { cn } from "./cn.ts"
import { iconButton } from "./panel.ts"

/** Shared box for filled, danger and secondary (`action`) controls so adjacent buttons and links match in height, radius and centering. */
const BUTTON_FRAME =
  "inline-flex items-center justify-center rounded-sm border-hairline px-3.5 py-1.5 text-center font-sans text-meta not-italic normal-nums no-underline active:scale-97 motion-reduce:active:scale-none disabled:cursor-default disabled:opacity-50 touch:min-h-10 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-focus"

const ACTION = `${BUTTON_FRAME} border-line bg-inset hover:border-line-active hover:bg-menu`

/** Primary (`bg-accent`), danger (`bg-error`), or neutral secondary (`bg-inset`) button recipe; works on `<button>` and `<a>`. */
export const buttonClass = ({
  danger = false,
  secondary = false,
}: { danger?: boolean; secondary?: boolean } = {}): string =>
  secondary
    ? `${ACTION} text-ink`
    : `${BUTTON_FRAME} border-transparent font-semibold text-paper ${danger ? "bg-error" : "bg-accent"}`

/**
 * `link`: an accent text action (create PR, toggle scope). `filled`: the filled action of `buttonClass()` (an empty
 * state's "Start"). `danger`: the same in the error colour. `action`: a quiet bordered action beside a setting or
 * primary action, sharing the same frame and height.
 * `floating`: an action raised over content (a preview's
 * "ask in chat" beside a selection); the caller places it. `row`: a whole list row that opens something; the caller's
 * class paints it all, cursor included. `card`: a pickable tile (the theme gallery); the caller passes its
 * picked/unpicked border and fill.
 * `hit` sizes a link's invisible touch target to the room around it: `roomy` alone in a header, `tight` in a wrapped
 * row of links. A class the caller passes must not set what the variant or hit already sets (position, colour,
 * padding): with no class merging, which one wins is the stylesheet's order, not the prop's.
 */
const VARIANT = {
  link: "link text-accent hover:underline",
  filled: buttonClass(),
  danger: buttonClass({ danger: true }),
  action: buttonClass({ secondary: true }),
  /** The quiet action that deletes something, beside its Cancel and Save. */
  actionDanger: `${ACTION} text-error`,
  floating:
    "whitespace-nowrap rounded-sm border-hairline border-line-active bg-surface px-2 py-0.5 font-mono text-meta text-ink shadow-popover",
  row: "",
  /** A bracketed choice among a few (the attempts strip): quiet until hovered, the accent while it is the current one (`aria-current`). */
  pill: "inline-flex flex-none items-center gap-1.5 whitespace-nowrap font-mono text-meta text-muted hover:text-ink aria-[current=true]:text-accent",
  /** A small glyph-only button in a bar (the Browser's); `iconOn` while what it toggles is on. The caller passes the `svg` and an `aria-label`. */
  icon: iconButton({ small: true }),
  iconOn: iconButton({ small: true, on: true }),
  card: "flex min-w-0 flex-col gap-1.5 rounded-sm border-hairline p-1.5 text-left focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-focus",
} as const

const HIT = {
  roomy: "relative touch:after:absolute touch:after:content-[''] touch:after:-inset-x-1.5 touch:after:-inset-y-3",
  tight: "relative touch:after:absolute touch:after:content-[''] touch:after:-inset-x-0.75 touch:after:-inset-y-0.5",
  none: "",
} as const

export function Button({
  variant = "link",
  hit = variant === "link" ? "roomy" : "none",
  className,
  type = "button",
  ...rest
}: { variant?: keyof typeof VARIANT; hit?: keyof typeof HIT } & ComponentProps<"button">) {
  return <button type={type} className={cn(VARIANT[variant], HIT[hit], className)} {...rest} />
}
