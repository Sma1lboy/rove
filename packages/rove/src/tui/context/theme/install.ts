/**
 * Installing a theme into `<roveStateDir()>/themes/`: shared by `rove theme add` and the bridge's
 * `theme.install`, so both apply the same parse, schema check, name rule and no-clobber rule.
 * Errors are `ThemeInstallError` with a one-line reason; each caller words its own failure.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ThemeJson } from "../theme-core"
import { userThemesDir } from "./loader"
import { validateTheme } from "./schema"

/** Served from rove.run/themes (sources in `packages/rove-landing/themes/`), not bundled. */
export const HOSTED_THEMES = [
  "catppuccin",
  "dracula",
  "everforest",
  "gruvbox",
  "kanagawa",
  "nord",
  "opencode",
  "osaka-jade",
  "rose-pine",
  "solarized",
] as const

export const hostedThemeUrl = (name: string): string => `https://rove.run/themes/${name}.json`

export class ThemeInstallError extends Error {}

/** A theme JSON text, validated; the parsed value is what gets written back. */
export function parseTheme(text: string): ThemeJson {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new ThemeInstallError(`source is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  const result = validateTheme(parsed)
  if (!result.ok) throw new ThemeInstallError(`source is not a valid Rove theme: ${result.reason}`)
  return result.theme
}

/**
 * A name safe to turn into `<userThemesDir()>/<name>.json`. `join()` resolves `..`, so without this
 * `remove '../../x/notes'` would unlink a file outside the themes dir.
 */
export function isThemeName(name: string | undefined): name is string {
  return !!name && /^[a-zA-Z0-9._-]+$/.test(name) && name !== "." && name !== ".."
}

/** Writes `<name>.json` and returns its path; refuses an existing file unless `force`. */
export function writeUserTheme(name: string, theme: ThemeJson, force: boolean): string {
  if (!isThemeName(name))
    throw new ThemeInstallError(`invalid theme name "${name}" (use letters, digits, '.', '_', '-')`)
  const dir = userThemesDir()
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, `${name}.json`)
  if (existsSync(dest) && !force) throw new ThemeInstallError(`${dest} already exists (pass --force to overwrite)`)
  // Re-serialise the validated theme: strips BOM/odd whitespace, keeps key order.
  writeFileSync(dest, `${JSON.stringify(theme, null, 2)}\n`, "utf8")
  return dest
}
