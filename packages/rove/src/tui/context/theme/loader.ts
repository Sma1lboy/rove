/**
 * Loads user themes from `<roveStateDir()>/themes/*.json` (same shape as the
 * bundled ones; hand-written or `rove theme add <url>`), registered at boot via
 * `addTheme()`.
 *   - **Sync**: few files, and it must run BEFORE `<App />` mounts so the
 *     ThemeProvider's `init` sees `hasTheme(props.theme)`.
 *   - **Never throws**: a corrupt or schema-failing file is `console.warn`ed
 *     with its path and skipped; it must not crash boot.
 *   - **No mkdir**: a missing dir returns `[]`; only `rove theme add` creates it.
 *   - **Name = filename sans `.json`**. A bundled-name collision lets the user
 *     win (`addTheme` runs after the bundled set and overwrites).
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { errorMessage } from "@/lib/error-message"
import { roveStateDir } from "../../../env"
import type { ThemeJson } from "../theme-core"
import { validateTheme } from "./schema"

export function userThemesDir(): string {
  return join(roveStateDir(), "themes")
}

export type LoadedTheme = { name: string; theme: ThemeJson }

/** Invalid entries are `console.warn`ed and skipped. Safe before the ThemeProvider mounts. */
export function loadUserThemes(): LoadedTheme[] {
  const dir = userThemesDir()
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    // ENOENT (never ran `rove theme add`, the normal fresh-install case) or
    // EACCES: no user themes, no warning.
    return []
  }

  const out: LoadedTheme[] = []
  for (const file of entries) {
    if (!file.endsWith(".json")) continue
    const path = join(dir, file)
    let parsed: unknown
    try {
      const text = readFileSync(path, "utf8")
      parsed = JSON.parse(text)
    } catch (err) {
      const msg = errorMessage(err)
      console.warn(`[rove] skipping user theme ${path}: invalid JSON — ${msg}`)
      continue
    }
    const result = validateTheme(parsed)
    if (!result.ok) {
      console.warn(`[rove] skipping user theme ${path}: ${result.reason}`)
      continue
    }
    const name = file.slice(0, -".json".length)
    out.push({ name, theme: result.theme })
  }
  return out
}
