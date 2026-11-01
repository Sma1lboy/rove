/** Row shapes the Settings sections share: a switch, a one-of-many, and a click-to-cycle row. */

import type { ReactNode } from "react"
import { CHIPS_ROW, chipClass } from "./ui/form.ts"
import {
  PREF_CHECKBOX,
  PREF_CYCLE,
  PREF_CYCLE_LABEL,
  PREF_FIELD,
  PREF_HINT,
  PREF_LABEL,
  PREF_LABEL_BESIDE_HINT,
  PREF_LABEL_MONO,
  PREF_LEGEND,
  PREF_READONLY,
  PREF_ROW,
  SETTINGS_GROUP,
} from "./ui/settings.ts"

export function Group(props: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className={SETTINGS_GROUP}>
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
    <label className={PREF_ROW}>
      <input
        type="checkbox"
        className={`${PREF_CHECKBOX} touch:size-5`}
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className={props.hint ? PREF_LABEL_BESIDE_HINT : PREF_LABEL}>{props.label}</span>
      {props.hint && <span className={`${PREF_HINT} muted`}>{props.hint}</span>}
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
    <fieldset className={PREF_FIELD}>
      <legend className={PREF_LEGEND}>{props.label}</legend>
      <div className={`${CHIPS_ROW} clear-both`}>
        {props.picks.map((pick) => (
          <button
            type="button"
            key={pick.value}
            aria-pressed={pick.value === props.value}
            className={chipClass(pick.value === props.value)}
            onClick={() => pick.value !== props.value && props.onPick(pick.value)}
          >
            {pick.label}
          </button>
        ))}
      </div>
      {props.hint && <p className={`${PREF_HINT} muted`}>{props.hint}</p>}
    </fieldset>
  )
}

/** A row that shows its value and moves to the next one on click, like the TUI's `enter` rows. */
export function CycleRow(props: { label: string; hint?: string; disabled?: boolean; onCycle: () => void }) {
  return (
    <button type="button" className={PREF_CYCLE} disabled={props.disabled} onClick={props.onCycle}>
      <span className={PREF_CYCLE_LABEL}>{props.label}</span>
      {props.hint && <span className={`${PREF_HINT} muted`}>{props.hint}</span>}
    </button>
  )
}

/** Something this page shows but only the Mac may change (a command or path it would run or store). */
export function ReadOnlyRow(props: { label: string; note: string }) {
  return (
    <div className={PREF_READONLY}>
      <span className={`${PREF_LABEL_MONO} mono text-muted`}>{props.label}</span>
      <span className={`${PREF_HINT} muted`}>{props.note}</span>
    </div>
  )
}
