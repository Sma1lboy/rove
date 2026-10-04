/**
 * The house border style. opentui defaults Box to `borderStyle: "single"`
 * (square) with no global override, so a bare `border` silently opts out.
 * Spread this instead:
 *
 *     <box {...FRAME} borderColor={theme.border}>
 */

/** Border props every framed surface spreads. */
export const FRAME = { border: true, borderStyle: "rounded" } as const
