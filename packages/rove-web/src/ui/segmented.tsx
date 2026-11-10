import { cn } from "./cn.ts"

/** A short one-of-N choice drawn as joined options, the picked one raised. Names its group with `label`. */
export function Segmented<T extends string | number>({
  label,
  value,
  picks,
  onPick,
}: {
  label: string
  value: T
  picks: readonly { readonly value: T; readonly label: string }[]
  onPick: (next: T) => void
}) {
  return (
    <fieldset
      aria-label={label}
      className="m-0 inline-flex min-w-0 flex-wrap gap-0.5 rounded-sm border-hairline border-line bg-inset p-0.5"
    >
      {picks.map((pick) => {
        const on = pick.value === value
        return (
          <button
            type="button"
            key={pick.value}
            aria-pressed={on}
            className={cn(
              "rounded-xs px-2.5 py-1 font-sans text-meta whitespace-nowrap touch:min-h-9",
              "focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-focus",
              on ? "bg-menu text-ink" : "text-muted hover:bg-hover",
            )}
            onClick={() => !on && onPick(pick.value)}
          >
            {pick.label}
          </button>
        )
      })}
    </fieldset>
  )
}
