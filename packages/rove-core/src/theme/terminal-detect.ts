/**
 * Auto-detect and import color themes (and optional font family) from local terminal emulator
 * configs: Ghostty, Kitty, Alacritty, and WezTerm. Zero external dependencies, read-only probing
 * with an injectable environment for unit tests.
 */

import { readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { activateUserTheme, parseTheme, writeUserTheme } from "./install"
import {
  type PartialTerminalScheme,
  emptyPartialScheme,
  ghosttyThemeName,
  mergePartialSchemes,
  parseAlacrittyToml,
  parseGhosttyConfig,
  parseKittyConfig,
  parseWeztermLua,
} from "./terminal-parsers"
import { type TerminalScheme, finalizeTerminalScheme, themeFromTerminalScheme } from "./terminal-scheme"
import type { ThemeJson } from "./theme-data"

export const TERMINAL_IDS = ["ghostty", "kitty", "alacritty", "wezterm"] as const
export type TerminalId = (typeof TERMINAL_IDS)[number]

export const TERMINAL_LABELS: Readonly<Record<TerminalId, string>> = {
  ghostty: "Ghostty",
  kitty: "Kitty",
  alacritty: "Alacritty",
  wezterm: "WezTerm",
}

export function isTerminalId(value: string | undefined): value is TerminalId {
  return !!value && (TERMINAL_IDS as readonly string[]).includes(value)
}

export interface DetectedTerminalTheme {
  readonly id: TerminalId
  readonly label: string
  readonly configPath: string
  /** Default Rove theme name (`ghostty`, `kitty`, `alacritty`, `wezterm`). */
  readonly themeName: string
  /** Named scheme referenced inside the terminal config (e.g. Ghostty `theme = ...`, WezTerm `color_scheme`). */
  readonly sourceTheme?: string
  readonly scheme: TerminalScheme
  readonly theme: ThemeJson
}

export interface DetectTerminalEnv {
  readonly homeDir?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly platform?: NodeJS.Platform
  readonly readText?: (path: string) => string | null
  readonly readDir?: (dir: string) => string[]
}

interface ResolvedEnv {
  readonly homeDir: string
  readonly xdgConfigHome: string
  readonly appData?: string
  readonly platform: NodeJS.Platform
  readonly readText: (path: string) => string | null
  readonly readDir: (dir: string) => string[]
}

function defaultReadText(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

function defaultReadDir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function resolveEnv(opts?: DetectTerminalEnv): ResolvedEnv {
  const env = opts?.env ?? process.env
  const homeDir = opts?.homeDir ?? homedir()
  const rawXdg = env.XDG_CONFIG_HOME?.trim()
  const xdgConfigHome = rawXdg ? expandHome(rawXdg, homeDir) : join(homeDir, ".config")
  return {
    homeDir,
    xdgConfigHome,
    appData: env.APPDATA?.trim() || undefined,
    platform: opts?.platform ?? process.platform,
    readText: opts?.readText ?? defaultReadText,
    readDir: opts?.readDir ?? defaultReadDir,
  }
}

function expandHome(raw: string, homeDir: string): string {
  if (raw === "~") return homeDir
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return join(homeDir, raw.slice(2))
  return raw
}

function resolveRelative(raw: string, baseDir: string, homeDir: string): string {
  const expanded = expandHome(raw, homeDir)
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded)
}

/** Expand a single-level `*` filename wildcard (e.g. `themes/*.conf`) using `readDir`. */
function expandSimpleGlob(targetPath: string, readDir: (dir: string) => string[]): string[] {
  if (!targetPath.includes("*")) return [targetPath]
  const dir = dirname(targetPath)
  const pattern = targetPath.slice(dir.length + 1)
  if (pattern.includes("/") || pattern.includes("\\")) return []
  const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
  return readDir(dir)
    .filter((entry) => re.test(entry))
    .sort()
    .map((entry) => join(dir, entry))
}

function buildDetected(
  id: TerminalId,
  configPath: string,
  partial: PartialTerminalScheme,
  sourceTheme?: string,
): DetectedTerminalTheme | null {
  const scheme = finalizeTerminalScheme(partial)
  if (!scheme) return null
  const theme = parseTheme(JSON.stringify(themeFromTerminalScheme(scheme)))
  return {
    id,
    label: TERMINAL_LABELS[id],
    configPath,
    themeName: id,
    ...(sourceTheme ? { sourceTheme } : {}),
    scheme,
    theme,
  }
}

// ── Ghostty ──────────────────────────────────────────────────────────────────

function ghosttyThemeSearchDirs(env: ResolvedEnv): string[] {
  const dirs = [join(env.xdgConfigHome, "ghostty", "themes")]
  if (env.platform === "darwin") {
    dirs.push(
      join(env.homeDir, "Library", "Application Support", "com.mitchellh.ghostty", "themes"),
      "/Applications/Ghostty.app/Contents/Resources/ghostty/themes",
    )
  }
  dirs.push("/usr/share/ghostty/themes", "/usr/local/share/ghostty/themes")
  return dirs
}

function findGhosttyThemeFile(name: string, env: ResolvedEnv): string | null {
  if (name.includes("/") || name.startsWith("~")) {
    const direct = expandHome(name, env.homeDir)
    return env.readText(direct) !== null ? direct : null
  }
  for (const dir of ghosttyThemeSearchDirs(env)) {
    const direct = join(dir, name)
    if (env.readText(direct) !== null) return direct
    const lower = name.toLowerCase()
    const match = env.readDir(dir).find((entry) => entry.toLowerCase() === lower)
    if (match) return join(dir, match)
  }
  return null
}

function readGhosttyRecursive(
  filePath: string,
  env: ResolvedEnv,
  seen: Set<string>,
): { scheme: PartialTerminalScheme; themeSpec?: string } {
  const abs = resolve(filePath)
  if (seen.has(abs)) return { scheme: emptyPartialScheme() }
  seen.add(abs)
  const text = env.readText(abs)
  if (text === null) return { scheme: emptyPartialScheme() }

  const parsed = parseGhosttyConfig(text)
  let acc = parsed.scheme
  let themeSpec = parsed.themeSpec

  for (const inc of parsed.configFiles) {
    const target = resolveRelative(inc, dirname(abs), env.homeDir)
    const nested = readGhosttyRecursive(target, env, seen)
    acc = mergePartialSchemes(acc, nested.scheme)
    if (nested.themeSpec) themeSpec = nested.themeSpec
  }
  return { scheme: acc, themeSpec }
}

function detectGhostty(env: ResolvedEnv): DetectedTerminalTheme | null {
  // Ghostty reads XDG config first (`config`, then `config.ghostty`), then macOS Application Support.
  const candidates = [
    join(env.xdgConfigHome, "ghostty", "config"),
    join(env.xdgConfigHome, "ghostty", "config.ghostty"),
  ]
  if (env.platform === "darwin") {
    candidates.push(
      join(env.homeDir, "Library", "Application Support", "com.mitchellh.ghostty", "config"),
      join(env.homeDir, "Library", "Application Support", "com.mitchellh.ghostty", "config.ghostty"),
    )
  }

  let acc = emptyPartialScheme()
  let themeSpec: string | undefined
  let activePath: string | null = null
  const seen = new Set<string>()

  for (const candidate of candidates) {
    const raw = env.readText(candidate)
    if (raw === null) continue
    if (!activePath || raw.trim().length > 0) activePath = candidate
    const res = readGhosttyRecursive(candidate, env, seen)
    acc = mergePartialSchemes(acc, res.scheme)
    if (res.themeSpec) themeSpec = res.themeSpec
  }
  if (!activePath) return null

  let sourceTheme: string | undefined
  if (themeSpec) {
    const names = ghosttyThemeName(themeSpec)
    const preferred = names.dark ?? names.light
    if (preferred) {
      sourceTheme = preferred
      const themePath = findGhosttyThemeFile(preferred, env)
      if (themePath) {
        const themeText = env.readText(themePath)
        if (themeText !== null) {
          // Base theme first, inline config keys override it.
          acc = mergePartialSchemes(parseGhosttyConfig(themeText).scheme, acc)
        }
      }
    }
  }

  return buildDetected("ghostty", activePath, acc, sourceTheme)
}

// ── Kitty ────────────────────────────────────────────────────────────────────

function readKittyRecursive(filePath: string, env: ResolvedEnv, seen: Set<string>): PartialTerminalScheme {
  const abs = resolve(filePath)
  if (seen.has(abs)) return emptyPartialScheme()
  seen.add(abs)
  const text = env.readText(abs)
  if (text === null) return emptyPartialScheme()

  const parsed = parseKittyConfig(text)
  let acc = emptyPartialScheme()
  for (const inc of parsed.includes) {
    const resolved = resolveRelative(inc, dirname(abs), env.homeDir)
    for (const target of expandSimpleGlob(resolved, env.readDir)) {
      acc = mergePartialSchemes(acc, readKittyRecursive(target, env, seen))
    }
  }
  return mergePartialSchemes(acc, parsed.scheme)
}

function detectKitty(env: ResolvedEnv): DetectedTerminalTheme | null {
  const kittyDir = join(env.xdgConfigHome, "kitty")
  const mainPath = join(kittyDir, "kitty.conf")
  const themePath = join(kittyDir, "current-theme.conf")
  const hasMain = env.readText(mainPath) !== null
  const hasTheme = env.readText(themePath) !== null
  if (!hasMain && !hasTheme) return null

  const seen = new Set<string>()
  let acc = hasMain ? readKittyRecursive(mainPath, env, seen) : emptyPartialScheme()

  // If `current-theme.conf` exists and wasn't already pulled in via `include`, use it for colors
  // while keeping `kitty.conf` settings (like `font_family`) on top.
  if (hasTheme && !seen.has(resolve(themePath))) {
    const themeScheme = readKittyRecursive(themePath, env, seen)
    acc = mergePartialSchemes(themeScheme, acc)
  }

  const configPath = hasMain ? mainPath : themePath
  return buildDetected("kitty", configPath, acc)
}

// ── Alacritty ────────────────────────────────────────────────────────────────

function readAlacrittyRecursive(filePath: string, env: ResolvedEnv, seen: Set<string>): PartialTerminalScheme {
  const abs = resolve(filePath)
  if (seen.has(abs)) return emptyPartialScheme()
  seen.add(abs)
  const text = env.readText(abs)
  if (text === null) return emptyPartialScheme()

  const parsed = parseAlacrittyToml(text)
  let acc = emptyPartialScheme()
  for (const imp of parsed.imports) {
    const target = resolveRelative(imp, dirname(abs), env.homeDir)
    acc = mergePartialSchemes(acc, readAlacrittyRecursive(target, env, seen))
  }
  return mergePartialSchemes(acc, parsed.scheme)
}

function detectAlacritty(env: ResolvedEnv): DetectedTerminalTheme | null {
  const candidates = [
    join(env.xdgConfigHome, "alacritty", "alacritty.toml"),
    join(env.xdgConfigHome, "alacritty.toml"),
    join(env.homeDir, ".alacritty.toml"),
  ]
  if (env.platform === "win32" && env.appData) {
    candidates.unshift(join(env.appData, "alacritty", "alacritty.toml"))
  }

  const configPath = candidates.find((p) => env.readText(p) !== null)
  if (!configPath) return null

  const scheme = readAlacrittyRecursive(configPath, env, new Set<string>())
  return buildDetected("alacritty", configPath, scheme)
}

// ── WezTerm ──────────────────────────────────────────────────────────────────

function findWeztermSchemeToml(name: string, configPath: string, env: ResolvedEnv): string | null {
  const dirs = [join(dirname(configPath), "colors"), join(env.xdgConfigHome, "wezterm", "colors")]
  const lowerToml = `${name.toLowerCase()}.toml`
  const slugToml = `${name.toLowerCase().replace(/\s+/g, "-")}.toml`
  for (const dir of dirs) {
    const direct = join(dir, `${name}.toml`)
    if (env.readText(direct) !== null) return direct
    const match = env.readDir(dir).find((entry) => {
      const lower = entry.toLowerCase()
      return lower === lowerToml || lower === slugToml
    })
    if (match) return join(dir, match)
  }
  return null
}

function detectWezterm(env: ResolvedEnv): DetectedTerminalTheme | null {
  const candidates = [join(env.homeDir, ".wezterm.lua"), join(env.xdgConfigHome, "wezterm", "wezterm.lua")]
  const configPath = candidates.find((p) => env.readText(p) !== null)
  if (!configPath) return null

  const text = env.readText(configPath)
  if (text === null) return null

  const parsed = parseWeztermLua(text)
  let acc = parsed.scheme
  if (parsed.colorScheme) {
    const tomlPath = findWeztermSchemeToml(parsed.colorScheme, configPath, env)
    if (tomlPath) {
      const tomlText = env.readText(tomlPath)
      if (tomlText !== null) {
        acc = mergePartialSchemes(parseAlacrittyToml(tomlText).scheme, acc)
      }
    }
  }

  return buildDetected("wezterm", configPath, acc, parsed.colorScheme)
}

// ── Public API ───────────────────────────────────────────────────────────────

export function detectTerminalTheme(id: TerminalId, opts?: DetectTerminalEnv): DetectedTerminalTheme | null {
  const env = resolveEnv(opts)
  switch (id) {
    case "ghostty":
      return detectGhostty(env)
    case "kitty":
      return detectKitty(env)
    case "alacritty":
      return detectAlacritty(env)
    case "wezterm":
      return detectWezterm(env)
  }
}

/** Probe Ghostty, Kitty, Alacritty, and WezTerm on this machine; returns those with a readable color scheme. */
export function detectLocalTerminalThemes(opts?: DetectTerminalEnv): DetectedTerminalTheme[] {
  const env = resolveEnv(opts)
  const out: DetectedTerminalTheme[] = []
  for (const id of TERMINAL_IDS) {
    const found = detectTerminalTheme(id, env)
    if (found) out.push(found)
  }
  return out
}

export interface InstalledTerminalTheme {
  readonly terminal: TerminalId
  readonly label: string
  readonly name: string
  readonly path: string
  readonly configPath: string
  readonly activated: boolean
  readonly sourceTheme?: string
  readonly fontFamily?: string
}

/** Write a detected terminal theme into `<roveStateDir()>/themes/` and optionally switch `activeTheme` to it. */
export function installDetectedTerminalTheme(
  detected: DetectedTerminalTheme,
  opts: { name?: string; force?: boolean; activate?: boolean } = {},
): InstalledTerminalTheme {
  const name = opts.name ?? detected.themeName
  const path = writeUserTheme(name, detected.theme, opts.force ?? false)
  const activated = opts.activate ?? true
  if (activated) activateUserTheme(name)
  return {
    terminal: detected.id,
    label: detected.label,
    name,
    path,
    configPath: detected.configPath,
    activated,
    ...(detected.sourceTheme ? { sourceTheme: detected.sourceTheme } : {}),
    ...(detected.scheme.fontFamily ? { fontFamily: detected.scheme.fontFamily } : {}),
  }
}
