/**
 * A terminal emulator's color scheme file turned into a Rove theme, so `rove theme add` can make Rove
 * match the terminal it runs in. Reads the plain line formats terminals use for their schemes:
 * `key = value` with `palette = N=#hex`, `key value` with `colorN`, and `*.key: value` resource lines.
 * Opentui-free: the CLI imports it.
 */

import type { ThemeJson } from "../theme-core"
import { normalizeHex } from "./hex"

export interface TerminalScheme {
  readonly background: string
  readonly foreground: string
  /** ANSI 0–15; a slot the file never set is absent. */
  readonly ansi: ReadonlyArray<string | undefined>
}

const ANSI_NAMES = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const

/** `#rgb`, `#rrggbb`, `#rrggbbaa` or the same without `#`, as `#rrggbb`; a trailing comment is ignored. */
function color(raw: string): string | null {
  const value = (raw.trim().split(/\s+/)[0] ?? "").replace(/^["']|["']$/g, "")
  return normalizeHex(value.startsWith("#") ? value : `#${value}`)
}

/** `*.background`, `URxvt.color4`, `Color_4` → `background`, `color4`, `color4`. */
function normalizeKey(raw: string): string {
  return raw
    .trim()
    .replace(/^.*[.*]/, "")
    .replace(/[-_]/g, "")
    .toLowerCase()
}

/** `[key, value]`, split on the first `=`, `:` or run of whitespace; `null` for a blank or comment line. */
function splitLine(line: string): [string, string] | null {
  const trimmed = line.trim()
  if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("!") || trimmed.startsWith(";")) return null
  const m = /^([^\s=:]+)\s*(?:[=:]\s*|\s+)(.+)$/.exec(trimmed)
  return m ? [m[1] as string, (m[2] as string).trim()] : null
}

/** The scheme in `text`, or `null` when it names no background and foreground (not a scheme file). */
export function parseTerminalScheme(text: string): TerminalScheme | null {
  let background: string | null = null
  let foreground: string | null = null
  const ansi: Array<string | undefined> = new Array(16).fill(undefined)
  for (const line of text.split(/\r?\n/)) {
    const pair = splitLine(line)
    if (!pair) continue
    const key = normalizeKey(pair[0])
    const value = pair[1]
    if (key === "palette") {
      const m = /^(\d{1,2})\s*[=:]\s*(\S+)/.exec(value)
      const index = m ? Number(m[1]) : -1
      const hex = m ? color(m[2] as string) : null
      if (hex && index >= 0 && index < 16) ansi[index] = hex
      continue
    }
    const indexed = /^color(\d{1,2})$/.exec(key)
    if (indexed) {
      const index = Number(indexed[1])
      const hex = color(value)
      if (hex && index < 16) ansi[index] = hex
      continue
    }
    if (key !== "background" && key !== "foreground") continue
    const hex = color(value)
    if (!hex) continue
    if (key === "background") background = hex
    else foreground = hex
  }
  if (!background || !foreground) return null
  return { background, foreground, ansi }
}

/** `from` moved `amount` (0–1) of the way to `to`, per channel. */
export function mix(from: string, to: string, amount: number): string {
  const channel = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  let out = "#"
  for (let i = 0; i < 3; i++) {
    const value = Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * amount)
    out += value.toString(16).padStart(2, "0")
  }
  return out
}

/**
 * The scheme as a theme: its background and foreground, surfaces stepped from the background toward the
 * foreground, and the ANSI hues for the roles terminal programs give them (red errors, green additions).
 * A role whose color the file left out is omitted, so the theme's own fallback (usually text) applies.
 */
export function themeFromTerminalScheme(scheme: TerminalScheme): ThemeJson {
  const defs: Record<string, string> = { background: scheme.background, foreground: scheme.foreground }
  scheme.ansi.forEach((hex, i) => {
    if (hex) defs[ANSI_NAMES[i] as string] = hex
  })
  const bg = scheme.background
  const fg = scheme.foreground
  defs.panel = mix(bg, fg, 0.04)
  defs.element = mix(bg, fg, 0.08)
  defs.menu = mix(bg, fg, 0.12)
  defs.borderSubtle = mix(bg, fg, 0.14)
  defs.border = mix(bg, fg, 0.24)
  defs.borderActive = mix(bg, fg, 0.5)
  defs.muted = mix(fg, bg, 0.35)
  defs.subtle = mix(fg, bg, 0.55)

  const theme: Record<string, string> = {
    text: "foreground",
    textMuted: "muted",
    background: "background",
    backgroundPanel: "panel",
    backgroundElement: "element",
    backgroundMenu: "menu",
    backgroundDialog: "panel",
    border: "border",
    borderActive: "borderActive",
    borderSubtle: "borderSubtle",
    diffContext: "muted",
    diffHunkHeader: "muted",
    markdownText: "foreground",
    markdownBlockQuote: "muted",
    markdownHorizontalRule: "muted",
    markdownCodeBlock: "foreground",
    syntaxComment: "subtle",
    syntaxVariable: "foreground",
    syntaxPunctuation: "foreground",
    selectedListItemText: "background",
  }
  const hues: ReadonlyArray<readonly [slot: string, ...names: string[]]> = [
    ["primary", "blue", "brightBlue"],
    ["secondary", "magenta", "brightMagenta"],
    ["accent", "cyan", "brightCyan"],
    ["error", "red", "brightRed"],
    ["warning", "yellow", "brightYellow"],
    ["success", "green", "brightGreen"],
    ["info", "cyan", "brightCyan"],
    ["diffAdded", "green", "brightGreen"],
    ["diffRemoved", "red", "brightRed"],
    ["markdownHeading", "blue", "brightBlue"],
    ["markdownLink", "cyan", "brightCyan"],
    ["markdownLinkText", "blue", "brightBlue"],
    ["markdownCode", "green", "brightGreen"],
    ["markdownEmph", "yellow", "brightYellow"],
    ["markdownStrong", "magenta", "brightMagenta"],
    ["markdownListItem", "cyan", "brightCyan"],
    ["syntaxKeyword", "magenta", "brightMagenta"],
    ["syntaxFunction", "blue", "brightBlue"],
    ["syntaxString", "green", "brightGreen"],
    ["syntaxNumber", "yellow", "brightYellow"],
    ["syntaxType", "cyan", "brightCyan"],
    ["syntaxOperator", "cyan", "brightCyan"],
  ]
  for (const [slot, ...names] of hues) {
    const name = names.find((n) => defs[n])
    if (name) theme[slot] = name
  }
  if (defs.green) defs.addedBg = mix(bg, defs.green, 0.16)
  if (defs.red) defs.removedBg = mix(bg, defs.red, 0.16)
  if (defs.addedBg) theme.diffAddedBg = "addedBg"
  if (defs.removedBg) theme.diffRemovedBg = "removedBg"
  // A def named like a slot (`background`, `border`) reads as a circular ref, so every def is prefixed.
  const ref = (name: string) => `scheme.${name}`
  return {
    defs: Object.fromEntries(Object.entries(defs).map(([name, hex]) => [ref(name), hex])),
    theme: Object.fromEntries(Object.entries(theme).map(([slot, name]) => [slot, ref(name)])),
  } as ThemeJson
}
