/** What a routine's runs launch on, as both Routines pages word it. */

import type { Automation } from "@sma1lboy/rove-daemon/daemon/contracts"

type Launch = Pick<Automation, "script" | "target" | "vendor" | "model" | "modelEffort">

export interface RoutineEngineText {
  /** Engine name, then the pinned model and effort: the detail's line. */
  readonly full: string
  /** What a list row has room for: the pinned model, else the engine's name. */
  readonly short: string
}

/**
 * Null for a script (no engine) and for a routine bound to an existing tab
 * (that tab keeps its own engine). `unset` names a routine that stores no
 * vendor: its runs launch the default.
 */
export function routineEngineText(
  routine: Launch,
  nameOf: (vendor: string) => string,
  unset: string,
): RoutineEngineText | null {
  if (routine.script || routine.target) return null
  const name = routine.vendor ? nameOf(routine.vendor) : unset
  return {
    full: [name, routine.model, routine.modelEffort].filter(Boolean).join(" · "),
    short: routine.model ?? name,
  }
}
