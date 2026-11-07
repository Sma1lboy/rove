/**
 * Run errors and responses as people read them. A script run's error is often
 * `script exited 1: {"error":{"message":…,"code":…}}`: the row shows the message and the
 * expanded view the JSON indented; anything else passes through unchanged.
 */

/** The first `{…}` that parses as JSON, with the text before it; null when there is none. */
function embeddedJson(text: string): { prefix: string; value: unknown } | null {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    return { prefix: text.slice(0, start).trim(), value: JSON.parse(text.slice(start, end + 1)) }
  } catch {
    return null
  }
}

const field = (value: unknown, key: string): unknown =>
  value && typeof value === "object" ? Reflect.get(value, key) : undefined

export function runErrorText(error: string): { summary: string; full: string } {
  const found = embeddedJson(error)
  if (!found) return { summary: error, full: error }
  const inner = field(found.value, "error") ?? found.value
  const message = field(inner, "message")
  const code = field(inner, "code")
  const said = typeof message === "string" ? (typeof code === "string" ? `${code}: ${message}` : message) : null
  const prefix = found.prefix.replace(/:$/, "")
  return {
    summary: said ? `${prefix} — ${said}` : error,
    full: `${found.prefix}\n${JSON.stringify(found.value, null, 2)}`,
  }
}

/** A response that is one JSON value reads indented; prose stays as the agent wrote it. */
export function responseText(text: string): string {
  const trimmed = text.trim()
  if (!/^[[{]/.test(trimmed)) return text
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return text
  }
}
