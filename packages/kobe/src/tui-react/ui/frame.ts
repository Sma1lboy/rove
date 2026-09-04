/**
 * The house border style, in one place.
 *
 * opentui hard-codes `borderStyle: "single"` (square corners) as its Box
 * default and offers no global override, so every framed surface in the TUI
 * has to opt into rounded corners itself. A box that says `border` and
 * nothing else silently opts OUT of the house style, and a square frame beside
 * rounded neighbours reads as foreign — which is a rule nobody follows
 * reliably from memory.
 *
 * Spread this instead of writing `border` by hand:
 *
 *     <box {...FRAME} borderColor={theme.border}>
 *
 * The point is not saving two words. It is that the next framed box comes out
 * rounded because its author spread the shared thing, rather than because they
 * remembered a prop whose absence is invisible in review and only surfaces as
 * a corner glyph in a screenshot.
 */

/** Border props every framed surface spreads. Rounded — see the module note. */
export const FRAME = { border: true, borderStyle: "rounded" } as const
