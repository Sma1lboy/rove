/** Row shapes the Settings sections share: a switch, a one-of-many, and a click-to-cycle row. */

import type { ReactNode } from "react"

export function Group(props: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h2 className="kicker">{props.title}</h2>
      {props.hint && <p className="muted">{props.hint}</p>}
      {props.children}
    </section>
  )
}

export function Toggle(props: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="pref-row">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="pref-label">{props.label}</span>
      {props.hint && <span className="pref-hint muted">{props.hint}</span>}
    </label>
  )
}

export interface Pick<T extends string | number> {
  readonly value: T
  readonly label: string
}

/** One of several, all visible: the TUI's picker list laid flat. */
export function Chips<T extends string | number>(props: {
  label: string
  hint?: string
  value: T
  picks: readonly Pick<T>[]
  onPick: (next: T) => void
}) {
  return (
    <fieldset className="pref-field">
      <legend className="pref-label">{props.label}</legend>
      <div className="chips-row">
        {props.picks.map((pick) => (
          <button
            type="button"
            key={pick.value}
            aria-pressed={pick.value === props.value}
            className={`chip-button ${pick.value === props.value ? "is-active" : ""}`}
            onClick={() => pick.value !== props.value && props.onPick(pick.value)}
          >
            {pick.label}
          </button>
        ))}
      </div>
      {props.hint && <p className="pref-hint muted">{props.hint}</p>}
    </fieldset>
  )
}

/** A row that shows its value and moves to the next one on click, like the TUI's `enter` rows. */
export function CycleRow(props: { label: string; hint?: string; disabled?: boolean; onCycle: () => void }) {
  return (
    <button type="button" className="pref-cycle" disabled={props.disabled} onClick={props.onCycle}>
      <span className="pref-label">{props.label}</span>
      {props.hint && <span className="pref-hint muted">{props.hint}</span>}
    </button>
  )
}

/** Something this page shows but only the Mac may change (a command or path it would run or store). */
export function ReadOnlyRow(props: { label: string; note: string }) {
  return (
    <div className="pref-readonly">
      <span className="pref-label mono">{props.label}</span>
      <span className="pref-hint muted">{props.note}</span>
    </div>
  )
}
