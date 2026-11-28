/**
 * Zero-dependency parsers for local terminal emulator config formats:
 * Ghostty and Kitty line parsers plus shared partial-scheme helpers; Alacritty TOML
 * and WezTerm Lua/TOML live in `./terminal-toml-lua` and are re-exported here.
 */

import { normalizeHex } from "./hex"

export {
  type AlacrittyParseResult,
  type WeztermParseResult,
  parseAlacrittyToml,
  parseWeztermLua,
} from "./terminal-toml-lua"

export interface PartialTerminalScheme {
  background?: string
  foreground?: string
  cursor?: string
  fontFamily?: string
  /** ANSI 0–15; unset slots are `undefined`. */
  ansi: Array<string | undefined>
}

export function emptyPartialScheme(): PartialTerminalScheme {
  return { ansi: new Array<string | undefined>(16).fill(undefined) }
}

export function mergePartialSchemes(
  base: PartialTerminalScheme,
  override: PartialTerminalScheme,
): PartialTerminalScheme {
  const ansi = base.ansi.slice(0, 16)
  while (ansi.length < 16) ansi.push(undefined)
  for (let i = 0; i < 16; i += 1) {
    if (override.ansi[i]) ansi[i] = override.ansi[i]
  }
  return {
    background: override.background ?? base.background,
    foreground: override.foreground ?? base.foreground,
    cursor: override.cursor ?? base.cursor,
    fontFamily: override.fontFamily ?? base.fontFamily,
    ansi,
  }
}

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `0xrrggbb` or bare `rrggbb`, as `#rrggbb`. */
export function parseSchemeColor(raw: string): string | null {
  const trimmed = raw.trim().replace(/^["']|["']$/g, "")
  const token = (trimmed.split(/\s+/)[0] ?? "").replace(/^["']|["']$/g, "")
  if (!token) return null
  if (/^0x[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/i.test(token)) {
    return normalizeHex(`#${token.slice(2)}`)
  }
  return normalizeHex(token.startsWith("#") ? token : `#${token}`)
}

/** Clean a raw font-family value; returns `undefined` for empty, `auto`, or unsafe strings. */
export function cleanFontFamily(raw: string): string | undefined {
  let value = raw.trim()
  if (!value) return undefined
  // Kitty's newer syntax: `font_family family="JetBrains Mono" postscript_name=...`
  const kittyFamily = /(?:^|\s)family=(?:"([^"]+)"|'([^']+)'|([^\s]+))/.exec(value)
  if (kittyFamily) {
    value = (kittyFamily[1] ?? kittyFamily[2] ?? kittyFamily[3] ?? "").trim()
  } else if ((value.startsWith('"') && value.includes('"', 1)) || (value.startsWith("'") && value.includes("'", 1))) {
    const q = value[0] as string
    value = value.slice(1, value.indexOf(q, 1)).trim()
  } else {
    const comment = value.indexOf("#")
    if (comment >= 0) value = value.slice(0, comment).trim()
    value = value.replace(/^["']|["']$/g, "").trim()
  }
  if (!value || value.toLowerCase() === "auto" || value.toLowerCase() === "none") return undefined
  if (/[\r\n;{}]/.test(value)) return undefined
  return value
}

export interface GhosttyParseResult {
  readonly scheme: PartialTerminalScheme
  readonly configFiles: readonly string[]
  readonly themeSpec?: string
}

/** Parse Ghostty `key = value` config, collecting colors, font-family, `config-file`, and `theme`. */
export function parseGhosttyConfig(text: string): GhosttyParseResult {
  const scheme = emptyPartialScheme()
  const configFiles: string[] = []
  let themeSpec: string | undefined
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1).trim()
    if (key === "config-file") {
      // Optional includes start with `?` in Ghostty.
      const path = value
        .replace(/^["']|["']$/g, "")
        .replace(/^\?/, "")
        .trim()
      if (path) configFiles.push(path)
      continue
    }
    if (key === "theme") {
      const cleaned = value.replace(/^["']|["']$/g, "").trim()
      if (cleaned) themeSpec = cleaned
      continue
    }
    if (key === "font-family") {
      const family = cleanFontFamily(value)
      if (!value || value === '""' || value === "''") {
        // Ghostty resets accumulated font-family entries with an empty assignment.
        scheme.fontFamily = undefined
      } else if (family && !scheme.fontFamily) {
        scheme.fontFamily = family
      }
      continue
    }
    if (key === "palette") {
      const m = /^(\d{1,2})\s*[=:]\s*(\S+)/.exec(value)
      const idx = m ? Number(m[1]) : -1
      const hex = m ? parseSchemeColor(m[2] as string) : null
      if (hex && idx >= 0 && idx < 16) scheme.ansi[idx] = hex
      continue
    }
    if (key === "background" || key === "foreground" || key === "cursor-color" || key === "cursor") {
      const hex = parseSchemeColor(value)
      if (!hex) continue
      if (key === "background") scheme.background = hex
      else if (key === "foreground") scheme.foreground = hex
      else scheme.cursor = hex
    }
  }
  return { scheme, configFiles, themeSpec }
}

/**
 * Ghostty's `theme` value can be a plain name (`Catppuccin Mocha`) or a split spec
 * (`dark:Catppuccin Mocha,light:Catppuccin Latte`). Returns the dark name first when split.
 */
export function ghosttyThemeName(spec: string): { dark?: string; light?: string } {
  if (!spec.includes(":")) return { dark: spec.trim() || undefined }
  let dark: string | undefined
  let light: string | undefined
  for (const part of spec.split(",")) {
    const idx = part.indexOf(":")
    if (idx <= 0) continue
    const mode = part.slice(0, idx).trim().toLowerCase()
    const name = part.slice(idx + 1).trim()
    if (!name) continue
    if (mode === "dark") dark = name
    else if (mode === "light") light = name
  }
  return { dark, light }
}

export interface KittyParseResult {
  readonly scheme: PartialTerminalScheme
  readonly includes: readonly string[]
}

/** Parse Kitty `key value` config, collecting colors, font_family, and `include` directives. */
export function parseKittyConfig(text: string): KittyParseResult {
  const scheme = emptyPartialScheme()
  const includes: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const m = /^([^\s]+)\s+(.+)$/.exec(line)
    if (!m) continue
    const key = (m[1] as string).toLowerCase()
    const value = (m[2] as string).trim()
    if (key === "include" || key === "envinclude") {
      if (key === "include") {
        const target = value.replace(/^["']|["']$/g, "").trim()
        if (target) includes.push(target)
      }
      continue
    }
    if (key === "font_family") {
      const family = cleanFontFamily(value)
      if (family) scheme.fontFamily = family
      continue
    }
    const colorIdx = /^color(\d{1,2})$/.exec(key)
    if (colorIdx) {
      const idx = Number(colorIdx[1])
      const hex = parseSchemeColor(value)
      if (hex && idx >= 0 && idx < 16) scheme.ansi[idx] = hex
      continue
    }
    if (key === "background" || key === "foreground" || key === "cursor") {
      const hex = parseSchemeColor(value)
      if (!hex) continue
      if (key === "background") scheme.background = hex
      else if (key === "foreground") scheme.foreground = hex
      else scheme.cursor = hex
    }
  }
  return { scheme, includes }
}
