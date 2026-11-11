import type { ReactNode } from "react"
import { cn } from "./cn.ts"

const CAP =
  "group/cap relative inline-flex flex-none items-stretch rounded-sm border-hairline bg-surface font-mono text-meta has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus"
const TONE = {
  idle: "border-line text-ink hover:border-line-active",
  changed: "border-line text-accent hover:border-line-active",
  empty: "border-dashed border-line text-subtle hover:border-line-active",
  active: "border-accent text-accent",
} as const

/** The `×` badge on the cap's corner: out of sight until the cap is hovered or focused; touch has no hover, so it stays. */
const REMOVE =
  "absolute -top-1.5 -right-1.5 flex size-4 cursor-pointer items-center justify-center rounded-full border-hairline border-line bg-paper p-0 leading-none text-subtle hover:border-line-active hover:text-error focus-visible:opacity-100 group-hover/cap:opacity-100 touch:size-5 touch:opacity-100 touch:after:absolute touch:after:-inset-2.5 touch:after:content-['']"

/**
 * A binding's chord as a keycap. Pressing the cap starts recording a new chord; the `×` on its
 * corner removes the binding. `tone`: `changed` once it differs from the default, `empty` with nothing
 * bound, `active` while it waits for the key.
 */
export function Keycap(props: {
  tone?: keyof typeof TONE
  /** Names the cap's action for assistive tech, e.g. "Record a key for New task". */
  label: string
  onPress: () => void
  /** Omit to draw no `×` (nothing to remove). */
  onRemove?: () => void
  removeLabel?: string
  /** Keep the `×` in sight without a hover: the cap was just recorded. */
  removeShown?: boolean
  children: ReactNode
}) {
  return (
    <span className={cn(CAP, TONE[props.tone ?? "idle"])}>
      <button type="button" aria-label={props.label} className="px-2 py-1 touch:min-h-10" onClick={props.onPress}>
        {props.children}
      </button>
      {props.onRemove && (
        <button
          type="button"
          aria-label={props.removeLabel}
          className={cn(REMOVE, !props.removeShown && "opacity-0")}
          onClick={props.onRemove}
        >
          ×
        </button>
      )}
    </span>
  )
}
