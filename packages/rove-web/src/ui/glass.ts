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

/** The phone's button shape: a rounded square, radius 12 at 44px (the composer's Send, the keys, back, ×). */
export const SQUARE = "rounded-[12px]"
/** The same shape at the bottom bar's 52px. */
export const SQUARE_BAR = "rounded-[14px]"

/** A pressed control gives a little under the finger; no motion when the system asks for none. */
export const PRESS =
  "transition-transform duration-120 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-none"

/** Under a mouse a glass control lightens: the hover wash over its own fill. `hover:` needs a pointer that hovers, so a tap leaves nothing behind. */
export const GLASS_HOVER = "enabled:hover:bg-[linear-gradient(var(--hover),var(--hover))]"
/** The same for a fill drawn by a child of the control, which is the `group/glass`. */
export const GLASS_HOVER_IN = "group-enabled/glass:group-hover/glass:bg-[linear-gradient(var(--hover),var(--hover))]"
