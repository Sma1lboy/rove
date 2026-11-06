/** The Files panel's Notes tab: a checklist and a free-text box, both quiet. */

/** One-line and multi-line fields share the look: a hairline box that lights its border on focus. */
export const NOTE_FIELD =
  "w-full min-w-0 rounded-sm border-hairline border-line bg-paper px-2 py-1 font-mono text-meta text-ink outline-none placeholder:text-subtle focus-visible:border-accent"

export const NOTE_AREA = `${NOTE_FIELD} min-h-24 resize-none leading-[1.45]`

/** A todo's text: struck and dim once done. */
export const todoTextClass = (done: boolean): string =>
  `min-w-0 flex-1 cursor-text break-words text-left font-mono text-meta ${done ? "text-subtle line-through" : "text-ink"}`
