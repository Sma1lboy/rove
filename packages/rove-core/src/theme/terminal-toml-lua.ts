/**
 * Zero-dependency parsers for Alacritty TOML and WezTerm Lua/TOML configs.
 * Static text parsing only — never executes Lua or spawns a terminal process.
 */

import { type PartialTerminalScheme, cleanFontFamily, emptyPartialScheme, parseSchemeColor } from "./terminal-parsers"

const TOML_COLOR_NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const

/** Strip an unquoted `#` comment from a TOML line. */
function stripTomlComment(line: string): string {
  let quote: '"' | "'" | null = null
  let escaped = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] as string
    if (quote) {
      if (quote === '"' && ch === "\\" && !escaped) {
        escaped = true
        continue
      }
      if (ch === quote && !escaped) quote = null
      escaped = false
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === "#") return line.slice(0, i)
  }
  return line
}

function unquoteTomlString(raw: string): string | null {
  const s = raw.trim()
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    return s
      .slice(1, -1)
      .replace(/\\(["\\])/g, "$1")
      .replace(/\\t/g, "\t")
      .replace(/\\n/g, "\n")
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1)
  }
  return null
}

/** Parse a TOML array of string literals (single or multi-line). */
function parseTomlStringArray(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return []
  const inner = trimmed.slice(1, -1)
  const items: string[] = []
  let i = 0
  while (i < inner.length) {
    const ch = inner[i] as string
    if (ch === '"' || ch === "'") {
      const start = i
      i += 1
      while (i < inner.length) {
        if (ch === '"' && inner[i] === "\\") {
          i += 2
          continue
        }
        if (inner[i] === ch) {
          i += 1
          break
        }
        i += 1
      }
      const unquoted = unquoteTomlString(inner.slice(start, i))
      if (unquoted !== null) items.push(unquoted)
      continue
    }
    i += 1
  }
  return items
}

/** Parse top-level `key = value` entries inside a `{ ... }` inline TOML table. */
function parseTomlInlineTable(raw: string): Array<[string, string]> {
  const trimmed = raw.trim()
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return []
  const inner = trimmed.slice(1, -1)
  const pairs: Array<[string, string]> = []
  let start = 0
  let quote: '"' | "'" | null = null
  let depth = 0
  let escaped = false
  const pushPart = (segment: string) => {
    const eq = segment.indexOf("=")
    if (eq > 0) pairs.push([segment.slice(0, eq).trim(), segment.slice(eq + 1).trim()])
  }
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i] as string
    if (quote) {
      if (quote === '"' && ch === "\\" && !escaped) {
        escaped = true
        continue
      }
      if (ch === quote && !escaped) quote = null
      escaped = false
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === "{" || ch === "[") depth += 1
    else if (ch === "}" || ch === "]") depth = Math.max(0, depth - 1)
    else if (ch === "," && depth === 0) {
      pushPart(inner.slice(start, i))
      start = i + 1
    }
  }
  pushPart(inner.slice(start))
  return pairs
}

function bracketDelta(text: string): number {
  let quote: '"' | "'" | null = null
  let escaped = false
  let delta = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string
    if (quote) {
      if (quote === '"' && ch === "\\" && !escaped) {
        escaped = true
        continue
      }
      if (ch === quote && !escaped) quote = null
      escaped = false
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === "[" || ch === "{") delta += 1
    else if (ch === "]" || ch === "}") delta -= 1
  }
  return delta
}

export interface AlacrittyParseResult {
  readonly scheme: PartialTerminalScheme
  readonly imports: readonly string[]
}

/**
 * Parse Alacritty's `alacritty.toml` (and WezTerm's `[colors]` TOML scheme files):
 * `[colors.primary]`, `[colors.cursor]`, `[colors.normal]`, `[colors.bright]`,
 * `[[colors.indexed_colors]]`, `[font.normal]`, `[general] import = [...]`,
 * and WezTerm `[colors]` `ansi = [...]` / `brights = [...]` / `cursor_bg`.
 */
export function parseAlacrittyToml(text: string): AlacrittyParseResult {
  const scheme = emptyPartialScheme()
  const imports: string[] = []
  let section = ""
  let indexedEntry: { index?: number; color?: string } | null = null

  const flushIndexed = () => {
    if (indexedEntry && indexedEntry.index !== undefined && indexedEntry.color) {
      if (indexedEntry.index >= 0 && indexedEntry.index < 16) {
        scheme.ansi[indexedEntry.index] = indexedEntry.color
      }
    }
    indexedEntry = null
  }

  const applyEntry = (fullKey: string, rawValue: string) => {
    const k = fullKey.toLowerCase()
    const val = rawValue.trim()

    if (val.startsWith("{") && val.endsWith("}")) {
      for (const [subKey, subVal] of parseTomlInlineTable(val)) {
        const cleanSub = subKey.replace(/^["']|["']$/g, "")
        applyEntry(`${k}.${cleanSub}`, subVal)
      }
      return
    }

    if (k === "import" || k === "general.import") {
      for (const item of parseTomlStringArray(val)) {
        if (item.trim()) imports.push(item.trim())
      }
      return
    }

    // WezTerm TOML color files store ansi/brights as 8-item arrays under `[colors]`.
    if (k === "colors.ansi" || k === "colors.brights") {
      const offset = k === "colors.brights" ? 8 : 0
      const arr = parseTomlStringArray(val)
      arr.slice(0, 8).forEach((entry, idx) => {
        const hex = parseSchemeColor(entry)
        if (hex) scheme.ansi[offset + idx] = hex
      })
      return
    }

    if (k === "colors.indexed_colors.index") {
      const idx = Number.parseInt(val, 10)
      if (indexedEntry && Number.isInteger(idx)) indexedEntry.index = idx
      return
    }
    if (k === "colors.indexed_colors.color") {
      const str = unquoteTomlString(val)
      const hex = str ? parseSchemeColor(str) : null
      if (indexedEntry && hex) indexedEntry.color = hex
      return
    }

    const str = unquoteTomlString(val)
    if (str === null) return

    if (k === "font.normal.family" || k === "font.family") {
      const family = cleanFontFamily(str)
      if (family && (k === "font.normal.family" || !scheme.fontFamily)) scheme.fontFamily = family
      return
    }

    if (k === "colors.primary.background" || k === "colors.background") {
      const hex = parseSchemeColor(str)
      if (hex) scheme.background = hex
      return
    }
    if (k === "colors.primary.foreground" || k === "colors.foreground") {
      const hex = parseSchemeColor(str)
      if (hex) scheme.foreground = hex
      return
    }
    if (k === "colors.cursor.cursor" || k === "colors.cursor_bg") {
      const hex = parseSchemeColor(str)
      if (hex) scheme.cursor = hex
      return
    }
    if (k.startsWith("colors.normal.") || k.startsWith("colors.bright.")) {
      const bright = k.startsWith("colors.bright.")
      const name = k.slice(bright ? "colors.bright.".length : "colors.normal.".length)
      const idx = (TOML_COLOR_NAMES as readonly string[]).indexOf(name)
      const hex = idx >= 0 ? parseSchemeColor(str) : null
      if (hex) scheme.ansi[(bright ? 8 : 0) + idx] = hex
    }
  }

  const lines = text.split(/\r?\n/)
  let pendingKey: string | null = null
  let pendingValue = ""
  let pendingDepth = 0

  for (const rawLine of lines) {
    const stripped = stripTomlComment(rawLine).trim()
    if (!stripped) continue

    if (pendingKey !== null) {
      pendingValue += ` ${stripped}`
      pendingDepth += bracketDelta(stripped)
      if (pendingDepth <= 0) {
        applyEntry(pendingKey, pendingValue)
        pendingKey = null
        pendingValue = ""
        pendingDepth = 0
      }
      continue
    }

    const arrayTable = /^\[\[([^\]]+)\]\]$/.exec(stripped)
    if (arrayTable) {
      flushIndexed()
      section = (arrayTable[1] as string).trim().toLowerCase()
      if (section === "colors.indexed_colors") indexedEntry = {}
      continue
    }

    const table = /^\[([^\]]+)\]$/.exec(stripped)
    if (table) {
      flushIndexed()
      section = (table[1] as string).trim().toLowerCase()
      continue
    }

    const eq = stripped.indexOf("=")
    if (eq <= 0) continue
    const keyPart = stripped
      .slice(0, eq)
      .trim()
      .split(".")
      .map((part) => part.trim().replace(/^["']|["']$/g, ""))
      .join(".")
    const valPart = stripped.slice(eq + 1).trim()
    const fullKey = section ? `${section}.${keyPart}` : keyPart
    const depth = bracketDelta(valPart)
    if (depth > 0) {
      pendingKey = fullKey
      pendingValue = valPart
      pendingDepth = depth
      continue
    }
    applyEntry(fullKey, valPart)
  }

  flushIndexed()
  return { scheme, imports }
}

// ── WezTerm Lua parser (static, zero external dependencies) ──────────────────

/** Strip Lua `--` line comments and `--[[ ... ]]` block comments while preserving quoted strings. */
function stripLuaComments(text: string): string {
  let out = ""
  let i = 0
  while (i < text.length) {
    const ch = text[i] as string
    if (ch === '"' || ch === "'") {
      const q = ch
      out += ch
      i += 1
      while (i < text.length) {
        const c = text[i] as string
        out += c
        if (c === "\\" && i + 1 < text.length) {
          out += text[i + 1] as string
          i += 2
          continue
        }
        i += 1
        if (c === q) break
      }
      continue
    }
    if (ch === "-" && text[i + 1] === "-") {
      const longOpen = /^\[(=*)\[/.exec(text.slice(i + 2))
      if (longOpen) {
        const closeToken = `]${longOpen[1]}]`
        const closeIdx = text.indexOf(closeToken, i + 2 + longOpen[0].length)
        if (closeIdx < 0) break
        out += "\n"
        i = closeIdx + closeToken.length
        continue
      }
      const nl = text.indexOf("\n", i + 2)
      if (nl < 0) break
      out += "\n"
      i = nl + 1
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** Extract the inner text of the balanced `{ ... }` starting at `openBraceIdx`, or `null`. */
function extractBalancedBraces(text: string, openBraceIdx: number): string | null {
  if (text[openBraceIdx] !== "{") return null
  let depth = 0
  let quote: '"' | "'" | null = null
  let escaped = false
  for (let i = openBraceIdx; i < text.length; i += 1) {
    const ch = text[i] as string
    if (quote) {
      if (ch === "\\" && !escaped) {
        escaped = true
        continue
      }
      if (ch === quote && !escaped) quote = null
      escaped = false
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) return text.slice(openBraceIdx + 1, i)
    }
  }
  return null
}

/** Extract all quoted string literals in order from a Lua snippet. */
function extractLuaStrings(snippet: string): string[] {
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g
  let m: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((m = re.exec(snippet)) !== null) {
    const raw = (m[1] ?? m[2] ?? "").replace(/\\(["'\\])/g, "$1")
    out.push(raw)
  }
  return out
}

export interface WeztermParseResult {
  readonly scheme: PartialTerminalScheme
  readonly colorScheme?: string
}

/** Parse basic colors (`colors = { ... }`, `color_scheme`) and font (`wezterm.font*`) from `wezterm.lua`. */
export function parseWeztermLua(text: string): WeztermParseResult {
  const clean = stripLuaComments(text)
  const scheme = emptyPartialScheme()

  const schemeMatch = /(?:^|[\s.,{;])color_scheme\s*=\s*(?:"([^"]+)"|'([^']+)')/.exec(clean)
  const colorScheme = (schemeMatch?.[1] ?? schemeMatch?.[2])?.trim() || undefined

  const colorsRe = /(?:^|[\s.,{;])colors\s*=\s*\{/g
  let cm: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((cm = colorsRe.exec(clean)) !== null) {
    const body = extractBalancedBraces(clean, cm.index + cm[0].length - 1)
    if (!body) continue
    const pickHex = (field: string): string | null => {
      const m = new RegExp(`(?:^|[\\s,{;])${field}\\s*=\\s*(?:"([^"]+)"|'([^']+)')`).exec(body)
      const raw = m?.[1] ?? m?.[2]
      return raw ? parseSchemeColor(raw) : null
    }
    const bg = pickHex("background")
    const fg = pickHex("foreground")
    const cursor = pickHex("cursor_bg")
    if (bg) scheme.background = bg
    if (fg) scheme.foreground = fg
    if (cursor) scheme.cursor = cursor

    for (const [key, offset] of [
      ["ansi", 0],
      ["brights", 8],
    ] as const) {
      const listMatch = new RegExp(`(?:^|[\\s,{;])${key}\\s*=\\s*\\{`).exec(body)
      if (!listMatch) continue
      const arrBody = extractBalancedBraces(body, listMatch.index + listMatch[0].length - 1)
      if (!arrBody) continue
      extractLuaStrings(arrBody)
        .slice(0, 8)
        .forEach((raw, idx) => {
          const hex = parseSchemeColor(raw)
          if (hex) scheme.ansi[offset + idx] = hex
        })
    }
  }

  for (const [field, target] of [
    ["background", "background"],
    ["foreground", "foreground"],
    ["cursor_bg", "cursor"],
  ] as const) {
    const m = new RegExp(`colors\\.${field}\\s*=\\s*(?:"([^"]+)"|'([^']+)')`).exec(clean)
    const raw = m?.[1] ?? m?.[2]
    const hex = raw ? parseSchemeColor(raw) : null
    if (hex) scheme[target] = hex
  }

  const fallbackMatch = /font_with_fallback\s*\(?\s*\{/.exec(clean)
  if (fallbackMatch) {
    const body = extractBalancedBraces(clean, fallbackMatch.index + fallbackMatch[0].length - 1)
    if (body) {
      const trimmed = body.trimStart()
      let candidate: string | undefined
      if (trimmed.startsWith("{")) {
        const firstObj = extractBalancedBraces(trimmed, 0)
        const fam = firstObj ? /family\s*=\s*(?:"([^"]+)"|'([^']+)')/.exec(firstObj) : null
        candidate = fam?.[1] ?? fam?.[2]
      } else {
        candidate = extractLuaStrings(trimmed)[0]
      }
      const cleaned = candidate ? cleanFontFamily(candidate) : undefined
      if (cleaned) scheme.fontFamily = cleaned
    }
  }

  if (!scheme.fontFamily) {
    const fontStr = /\bfont\s*\(\s*(?:"([^"]+)"|'([^']+)')/.exec(clean)
    const raw = fontStr?.[1] ?? fontStr?.[2]
    const cleaned = raw ? cleanFontFamily(raw) : undefined
    if (cleaned) scheme.fontFamily = cleaned
  }

  if (!scheme.fontFamily) {
    const fontTbl = /\bfont\s*\(?\s*\{/.exec(clean)
    if (fontTbl) {
      const body = extractBalancedBraces(clean, fontTbl.index + fontTbl[0].length - 1)
      const fam = body ? /family\s*=\s*(?:"([^"]+)"|'([^']+)')/.exec(body) : null
      const raw = fam?.[1] ?? fam?.[2]
      const cleaned = raw ? cleanFontFamily(raw) : undefined
      if (cleaned) scheme.fontFamily = cleaned
    }
  }

  return { scheme, colorScheme }
}
