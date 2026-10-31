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
