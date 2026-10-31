import type { ButtonHTMLAttributes } from "react"
import { cn } from "./cn.ts"

/**
 * `link`: an accent text action (create PR, toggle scope). `floating`: an action raised over content (a preview's
 * "ask in chat" beside a selection); the caller places it.
 * `hit` sizes a link's invisible touch target to the room around it: `roomy` alone in a header, `tight` in a wrapped
 * row of links. A class the caller passes must not set what the variant or hit already sets (position, colour,
 * padding): with no class merging, which one wins is the stylesheet's order, not the prop's.
 */
const VARIANT = {
  link: "text-accent hover:underline",
  floating:
    "whitespace-nowrap rounded-sm border-hairline border-line-active bg-surface px-2 py-0.5 font-mono text-meta text-ink shadow-popover",
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
}: { variant?: keyof typeof VARIANT; hit?: keyof typeof HIT } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cn(VARIANT[variant], HIT[hit], className)} {...rest} />
}
