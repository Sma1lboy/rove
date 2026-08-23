export const MESSAGE_PREVIEW_MAX_CHARS = 160

/** Collapse a message into one bounded, terminal-safe metadata preview. */
export function normalizeMessagePreview(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const singleLine = value.replace(/\s+/g, " ").trim()
  if (!singleLine) return undefined
  return [...singleLine].slice(0, MESSAGE_PREVIEW_MAX_CHARS).join("")
}
