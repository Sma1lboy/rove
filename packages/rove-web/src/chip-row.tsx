/**
 * The TUI's choose-one chip row: one Tab stop, Left/Right (and h/l) move the choice and the
 * focus with it, a click picks.
 */

import { useRef } from "react"
import { CHIPS_ROW, chipClass } from "./ui/form.ts"

export interface Chip {
  readonly id: string
  readonly label: string
  readonly title?: string
  /** A trailing dot for a choice that exists but is not ready. */
  readonly dim?: boolean
}

export function ChipRow(props: {
  label: string
  field: string
  choices: readonly Chip[]
  value: string
  onChange: (id: string) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  // Holds the latest choice, so two quick presses step twice before React re-renders.
  const current = useRef(props.value)
  current.current = props.value
  const move = (e: React.KeyboardEvent, dir: 1 | -1) => {
    e.preventDefault()
    const at = props.choices.findIndex((c) => c.id === current.current)
    const next = props.choices[(at + dir + props.choices.length) % props.choices.length]
    if (!next) return
    current.current = next.id
    props.onChange(next.id)
    // The chip re-renders with tabIndex 0; focus follows once it does.
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("[aria-pressed=true]")?.focus())
  }
  return (
    <div
      ref={root}
      className={CHIPS_ROW}
      aria-label={props.label}
      data-field={props.field}
      onKeyDown={(e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || props.choices.length === 0) return
        if (e.key === "ArrowRight" || e.key === "l") move(e, 1)
        else if (e.key === "ArrowLeft" || e.key === "h") move(e, -1)
      }}
    >
      {props.choices.map((chip) => (
        <button
          type="button"
          key={chip.id}
          aria-pressed={chip.id === props.value}
          tabIndex={chip.id === props.value || !props.choices.some((c) => c.id === props.value) ? 0 : -1}
          className={chipClass(chip.id === props.value, chip.dim)}
          title={chip.title}
          onClick={() => props.onChange(chip.id)}
        >
          {chip.label}
        </button>
      ))}
    </div>
  )
}
