import type { ReactNode } from "react"
import { RAIL_NAV_PLUS, railNavRowClass } from "./page.ts"

/** A row in the rail's page list: New task, a page, or the World map. */
export function RailNavRow({
  active = false,
  onSelect,
  plus = false,
  children,
}: {
  active?: boolean
  onSelect: () => void
  plus?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`rail-nav-row ${railNavRowClass(active)}`}
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
    >
      {children}
      {plus ? (
        <span className={RAIL_NAV_PLUS} aria-hidden="true">
          +
        </span>
      ) : null}
    </button>
  )
}
