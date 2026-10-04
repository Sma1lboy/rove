/** Default terminal colors and the OSC 10/11 query wire format. */

export interface TerminalDefaultColors {
  readonly foreground: `#${string}`
  readonly background: `#${string}`
}

export type DefaultColorSlot = 10 | 11

export const DEFAULT_TERMINAL_COLORS: TerminalDefaultColors = {
  foreground: "#eae7df",
  background: "#141413",
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i
// biome-ignore lint/suspicious/noControlCharactersInRegex: OSC is an ESC/BEL terminal protocol.
const DEFAULT_COLOR_QUERY_RE = /\x1b\](10|11);\?(?:\x07|\x1b\\)/g
const QUERY_PREFIXES = ["\x1b]10;?", "\x1b]11;?"] as const

function normalizeColor(value: unknown): `#${string}` | null {
  return typeof value === "string" && HEX_COLOR_RE.test(value) ? (value.toLowerCase() as `#${string}`) : null
}

/** Validate colors crossing the `pty.open` wire boundary. */
export function parseTerminalDefaultColors(value: unknown): TerminalDefaultColors | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const foreground = normalizeColor(raw.foreground)
  const background = normalizeColor(raw.background)
  return foreground && background ? { foreground, background } : null
}

function oscRgb(color: `#${string}`): string {
  const hex = color.slice(1)
  return [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((component) => component.repeat(2)).join("/")
}

/** One xterm-compatible OSC reply, terminated with ST. */
export function formatDefaultColorReply(slot: DefaultColorSlot, colors: TerminalDefaultColors): string {
  const color = slot === 10 ? colors.foreground : colors.background
  return `\x1b]${slot};rgb:${oscRgb(color)}\x1b\\`
}

function trailingQueryPrefix(text: string): string {
  const maxLength = QUERY_PREFIXES[0].length + 1
  const start = Math.max(0, text.length - maxLength)
  for (let index = start; index < text.length; index++) {
    const suffix = text.slice(index)
    if (QUERY_PREFIXES.some((prefix) => prefix.startsWith(suffix) || suffix === `${prefix}\x1b`)) return suffix
  }
  return ""
}

/**
 * Find complete OSC 10/11 queries while retaining a query split across PTY
 * read boundaries. The input is byte-preserving latin1 text; the protocol
 * itself is ASCII.
 */
export function foldDefaultColorQueries(
  previousCarry: string,
  chunkText: string,
): { slots: DefaultColorSlot[]; carry: string } {
  const text = previousCarry + chunkText
  const slots: DefaultColorSlot[] = []
  let end = 0
  DEFAULT_COLOR_QUERY_RE.lastIndex = 0
  for (let match = DEFAULT_COLOR_QUERY_RE.exec(text); match; match = DEFAULT_COLOR_QUERY_RE.exec(text)) {
    slots.push(match[1] === "10" ? 10 : 11)
    end = match.index + match[0].length
  }
  return { slots, carry: trailingQueryPrefix(text.slice(end)) }
}
