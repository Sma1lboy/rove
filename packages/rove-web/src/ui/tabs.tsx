import { cn } from "./cn.ts"

/**
 * A segmented tab row (All / Changes). The active tab turns accent while its pane holds focus: the pane carries
 * `group/pane`, the convention for any view that owns its keys.
 */
export function Tabs<Id extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: readonly { id: Id; label: string }[]
  value: Id
  onChange: (id: Id) => void
  className?: string
}) {
  return (
    <div className={cn("flex gap-1", className)} role="tablist">
      {tabs.map((tab) => {
        const on = tab.id === value
        return (
          <button
            type="button"
            role="tab"
            key={tab.id}
            aria-selected={on}
            className={cn(
              "relative rounded-sm px-2.5 py-0.75 font-mono text-meta font-semibold",
              "touch:after:absolute touch:after:content-[''] touch:after:-inset-x-0.5 touch:after:-top-2 touch:after:-bottom-1.5",
              on ? "bg-inset text-ink group-focus-within/pane:text-accent" : "text-muted",
            )}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
