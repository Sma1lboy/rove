/** Key hints on a touch screen: the TUI's legends name keys a soft keyboard does not have. */

/** The repo's one touch test; the CSS uses the same media query. */
export const TOUCH_QUERY = "(hover: none) and (pointer: coarse)"

export function isTouch(): boolean {
  return (
    typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(TOUCH_QUERY).matches
  )
}

/**
 * A legend segment that opens with a key: `enter …`, `ctrl+s …`, `←→ …`, `j/k …`, `q …`, `esc`.
 * `a` and `i` are left out of the letter keys: they open English sentences.
 */
const KEY_LEAD =
  /^(?:enter|return|tab|esc|space|shift|ctrl\+\S+|cmd\+\S+|alt\+\S+|[↑↓←→]+(?:\/[↑↓←→]+)?|[b-hj-z](?:\/[b-hj-z])?)(?:\/\S+)?(?:\s|$)/i

/**
 * A `·`-separated legend with its key segments dropped, for a touch screen: `who hands prompts to whom ·
 * click a session to open it · q close` keeps the first two. "" when every segment was a key.
 */
export function touchHint(text: string): string {
  return text
    .split("·")
    .map((part) => part.trim())
    .filter((part) => part && !KEY_LEAD.test(part))
    .join(" · ")
}

/** `text` as this device should show it: whole on a keyboard, key segments dropped on touch. */
export function deviceHint(text: string): string {
  return isTouch() ? touchHint(text) : text
}
