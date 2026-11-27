/**
 * The phone's floating controls, after iOS's glass buttons: a see-through fill that blurs what is behind it, a lit
 * top edge and one soft shadow. The owner's call for the composer, the terminal key row and the session bar only;
 * every other surface stays flat. `opaque` (tailwind.css) swaps the fill for a solid one where blur is missing or unwanted.
 */
const BLUR =
  "border-hairline backdrop-blur-md backdrop-saturate-150 [box-shadow:inset_0_1px_0_color-mix(in_srgb,white_14%,transparent),var(--shadow-popover)] opaque:backdrop-filter-none"
const TONE = {
  neutral:
    "border-[color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color-mix(in_srgb,var(--inset)_60%,transparent)] opaque:bg-inset",
  /** The control is on (a sticky key): its edge takes the accent. */
  on: "border-accent bg-[color-mix(in_srgb,var(--inset)_60%,transparent)] opaque:bg-inset",
} as const

export const glass = (tone: keyof typeof TONE = "neutral"): string => `${BLUR} ${TONE[tone]}`

/** A pressed control gives a little under the finger; no motion when the system asks for none. */
export const PRESS =
  "transition-transform duration-100 active:scale-94 motion-reduce:transition-none motion-reduce:active:scale-none"
