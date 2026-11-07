import type { Tone as RailTone } from "../rail-glyphs.ts"
/** The text colours a status can take. Literal class names, so Tailwind finds them. */
export const TONE = {
  accent: "text-accent",
  muted: "text-subtle",
  attention: "text-error",
  warning: "text-warning",
  info: "text-info",
  success: "text-success",
  added: "text-diff-added",
  removed: "text-diff-removed",
} as const

export type Tone = keyof typeof TONE

/** A rail/inbox `Tone` as a text colour. `info` reads as accent and `muted` as subtle, as the sheet's `tone-*` did. */
export const TONE_CLASS: Readonly<Record<RailTone, string>> = {
  accent: "text-accent",
  muted: "text-subtle",
  attention: "text-error",
  warning: "text-warning",
  success: "text-success",
  info: "text-accent",
  ink: "text-ink",
}
