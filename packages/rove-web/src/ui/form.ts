/** Dialog and settings form pieces: a labelled field, a multi-line input, a row of pickable chips, a choice list. */

import { GROW } from "./grow.ts"

/** A label (or kicker) stacked over its control. */
export const FIELD = "flex flex-col gap-1.5"

/** The name over a field: regular and muted, so the text in the field reads first. */
export const FIELD_LABEL = "font-sans text-meta font-normal normal-nums text-muted"

/** Added to `INPUT` or `SETTINGS_INPUT` on a `<textarea>`: about four lines, growing with its text (`useGrow`). */
export const TEXTAREA = `${GROW} min-h-24 leading-[1.45]`

export const CHIPS_ROW = "flex flex-wrap gap-1.5"

/** A pickable chip: `active` is the picked one, `dim` a suggestion the user has not confirmed. */
export const chipClass = (active = false, dim = false): string =>
  `rounded-sm border-hairline px-2.5 py-1 font-mono text-meta font-normal not-italic normal-nums ${
    active
      ? "border-accent bg-accent-soft text-ink"
      : `border-line hover:bg-hover ${dim ? "text-subtle" : "text-muted"}`
  }`

/** A bare `<ul>` of choice rows. */
export const CHOICES = "m-0 list-none p-0"
