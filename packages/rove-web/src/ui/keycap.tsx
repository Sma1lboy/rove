import type { ReactNode } from "react"
import { cn } from "./cn.ts"

const CAP =
  "inline-flex flex-none items-stretch rounded-sm border-hairline bg-surface font-mono text-meta has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus"
const TONE = {
  idle: "border-line text-ink hover:border-line-active",
  changed: "border-line text-accent hover:border-line-active",
  empty: "border-dashed border-line text-subtle hover:border-line-active",
  active: "border-accent text-accent",
} as const

/**
 * A binding's chord as a keycap. Pressing the cap starts recording a new chord; the `×` inside
 * removes the binding. `tone`: `changed` once it differs from the default, `empty` with nothing
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
          className="border-l-hairline border-l-line px-1.5 text-subtle hover:text-error touch:min-h-10 touch:px-3"
          onClick={props.onRemove}
        >
          ×
        </button>
      )}
    </span>
  )
}
