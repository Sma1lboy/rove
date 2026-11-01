import type { ButtonHTMLAttributes } from "react"
import { cn } from "./cn.ts"

/**
 * `link`: an accent text action (create PR, toggle scope). `floating`: an action raised over content (a preview's
 * "ask in chat" beside a selection); the caller places it. `row`: a whole list row that opens something; the caller's
 * class paints it all, cursor included.
 * `hit` sizes a link's invisible touch target to the room around it: `roomy` alone in a header, `tight` in a wrapped
 * row of links. A class the caller passes must not set what the variant or hit already sets (position, colour,
 * padding): with no class merging, which one wins is the stylesheet's order, not the prop's.
 */
const VARIANT = {
  link: "text-accent hover:underline",
  floating:
    "whitespace-nowrap rounded-sm border-hairline border-line-active bg-surface px-2 py-0.5 font-mono text-meta text-ink shadow-popover",
  row: "",
} as const

const HIT = {
  roomy: "relative touch:after:absolute touch:after:content-[''] touch:after:-inset-x-1.5 touch:after:-inset-y-3",
  tight: "relative touch:after:absolute touch:after:content-[''] touch:after:-inset-x-0.75 touch:after:-inset-y-0.5",
  none: "",
} as const

/** The filled action (`.button` before Tailwind). `danger` paints it the error colour; `box` is the Engines page's smaller one. */
export const buttonClass = ({ danger = false, box = false }: { danger?: boolean; box?: boolean } = {}): string =>
  `rounded-sm font-sans text-meta not-italic normal-nums text-paper active:scale-97 motion-reduce:active:scale-none disabled:cursor-default disabled:opacity-50 touch:min-h-10 ${
    danger ? "bg-error" : "bg-accent"
  } ${box ? "px-3 py-1.25 font-medium" : "px-3.5 py-1.5 font-semibold"}`

export function Button({
  variant = "link",
  hit = variant === "link" ? "roomy" : "none",
  className,
  type = "button",
  ...rest
}: { variant?: keyof typeof VARIANT; hit?: keyof typeof HIT } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cn(VARIANT[variant], HIT[hit], className)} {...rest} />
}
