/** A pasted link's badge in a prompt field (link-badges.tsx): drawn on a layer behind the field's transparent text. */

/** The field: its text is the layer's to draw, only the caret and placeholder show; no UA padding, which the layer lacks. */
export const FIELD = "relative p-0 text-transparent caret-ink placeholder:text-muted"
/** Same box and wrapping as the field, so every character lands where the field puts it. */
export const LAYER =
  "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap text-ink [overflow-wrap:break-word]"
/** Block padding only: on an inline box it paints without moving the line; the sides are spaces in the text. */
const PILL = "rounded-full py-[2px] box-decoration-clone"
export const BADGE = `${PILL} bg-hover text-ink`
/** Its title is still loading: a light band sweeps it. */
export const LOADING = `${PILL} text-muted bg-[linear-gradient(90deg,var(--hover)_0%,var(--hover)_35%,var(--line-active)_50%,var(--hover)_65%,var(--hover)_100%)] bg-size-[300%_100%] motion-safe:animate-shimmer`
/** A token whose link is unknown (edited into, or from an older draft). */
export const BROKEN = "text-muted"
const ICON = "absolute top-1/2 left-1/2 size-[1em] max-w-none -translate-x-1/2 -translate-y-1/2"
/** A white tile under the favicon: a dark transparent icon would vanish on a dark badge. */
export const FAVICON = `${ICON} rounded-[3px] bg-[#fff] p-px`
export const GLYPH = `${ICON} text-muted`
