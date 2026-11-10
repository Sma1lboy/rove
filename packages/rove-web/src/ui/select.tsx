import { Chevron } from "./chevron.tsx"

/** A one-of-N choice in a drop-down: the native list, drawn in the page's frame. Names itself with `label`. */
export function Select<T extends string | number>({
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
    <span className="relative inline-flex max-w-full min-w-0 text-ink">
      <select
        aria-label={label}
        value={value}
        className="max-w-full min-w-0 truncate rounded-sm border-hairline border-line bg-paper py-1.25 pr-7 pl-2.5 font-sans text-meta hover:border-line-active focus-visible:border-line-active focus-visible:outline-none touch:min-h-10"
        onChange={(e) => {
          const next = picks.find((pick) => String(pick.value) === e.target.value)
          if (next) onPick(next.value)
        }}
      >
        {picks.map((pick) => (
          <option key={pick.value} value={pick.value}>
            {pick.label}
          </option>
        ))}
      </select>
      <Chevron className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-subtle" />
    </span>
  )
}
