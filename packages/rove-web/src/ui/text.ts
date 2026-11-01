/** A one-line note where a list or view would be ("Loading…", "No files"). */
export const PLACEHOLDER_LINE = "mx-2.5 my-3 font-mono text-meta text-subtle"

/** A dialog's small print under a field or list. */
export const HINT = "font-sans text-meta text-subtle"

/** A task's first prompt, shown read-only (Run again). */
export const BRIEF =
  "m-0 max-h-[38vh] overflow-auto rounded-sm border-hairline border-line bg-paper px-3 py-2.5 font-mono text-meta leading-[1.5] whitespace-pre-wrap wrap-anywhere"

/** A boxed aside inside a dialog (the delete confirm under the field notes). */
export const INSET_BOX = "flex flex-col gap-2 rounded-sm border-hairline border-line bg-paper px-3 py-2.5"

/** The field-notes reader: a scrolling list of stacked notes. */
export const NOTES = "flex max-h-[44vh] flex-col gap-2 overflow-y-auto"
export const noteClass = (selected: boolean): string =>
  `flex w-full flex-col gap-0.5 rounded-sm px-2.5 py-1.5 text-left focus-visible:bg-accent-soft focus-visible:outline-none ${selected ? "bg-accent-soft" : ""}`

/** The suggestion list under a text field (suggest-field.tsx). */
export const SUGGEST_LIST =
  "mx-0 mt-1 mb-0 max-h-47 list-none overflow-y-auto rounded-sm border-hairline border-line bg-inset p-0.5 font-mono text-meta"
export const suggestRowClass = (o: { readonly cursor: boolean; readonly accent: boolean }): string =>
  `block w-full cursor-pointer overflow-hidden rounded-[calc(var(--radius-sm)-2px)] px-2 py-0.75 text-left text-ellipsis whitespace-nowrap [font:inherit] touch:py-2.5 ${o.cursor ? "bg-hover" : ""} ${o.accent ? "text-accent" : o.cursor ? "text-ink" : "text-muted"}`

/** A section's small label above a list or a block; the caller adds its colour (`text-muted` by default). */
export const KICKER = "m-0 font-sans text-meta font-medium normal-nums"

/** Meta-size monospace with its own weight and digits, as the old `font:` shorthand set them. */
export const MONO = "font-mono text-meta font-normal normal-nums"

/** An inline text action; `link` stays as a hook for the footer and dialog rules that dim a disabled one. */
export const LINK = "link [&:hover]:underline touch-hit"

/** A single-line text field. */
export const INPUT =
  "w-full rounded-sm border-hairline border-line bg-paper px-2.5 py-2 font-mono text-meta font-normal normal-nums focus-visible:border-line-active focus-visible:outline-none"

/** An empty list's note block; its paragraphs stack with a 4px gap. */
export const EMPTY = "px-2.5 py-4 font-mono text-size-meta [&_p]:mx-0 [&_p]:mt-0 [&_p]:mb-1"

/** A row of trailing actions: links and buttons pushed right. */
export const ACTIONS = "actions flex items-center justify-end gap-3.5"
