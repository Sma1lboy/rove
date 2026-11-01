/** Dialog and settings form pieces: a labelled field, a multi-line input, a row of pickable chips, a choice list. */

/** A label (or kicker) stacked over its control. */
export const FIELD = "flex flex-col gap-1.5"

/** Added to `.input` on a `<textarea>`. */
export const TEXTAREA = "min-h-18 max-h-[50vh] leading-[1.45]"

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
