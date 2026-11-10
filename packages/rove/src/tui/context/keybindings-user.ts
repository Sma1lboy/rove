/**
 * Loads `~/.rove/settings/keybindings.yaml` (via `src/state/keybindings-file.ts`;
 * the CLI always runs under Bun, so `Bun.YAML` exists) and MUTATES the matching
 * `RoveKeymap` rows in place for `process.platform`. Panes register through
 * `bindByIds`/`chordsOf` and legends render from the table, so one boot-time
 * mutation re-points every surface.
 *
 * Call `applyUserKeybindings()` ONCE per process BEFORE the first `render()`
 * (same slot as `loadUserThemes()`). Idempotent, never throws; a missing file
 * is the normal fresh-install case. Not applied at import: unit tests must see
 * pristine defaults whatever the developer's own file says.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { readKeybindingsFile, resetKeybindingsFileCache } from "../../state/keybindings-file"
import { type UserKeybindingsReport, resolveUserKeybindings } from "../lib/keybindings-resolve"
import { KEYBINDINGS_STARTER } from "../lib/keybindings-starter"
import { type KeybindingEdit, editKeybindingsYaml } from "../lib/keybindings-write"
import { configurePrefix, resetPrefixConfiguration } from "../lib/keymap-dispatch"
import type { PluginKeyBinding } from "../lib/keymap-plugin-bindings"
import { RoveKeymap, bumpKeymapVersion, defaultKeymapCopy, resetKeymapToDefaults } from "./keybindings"

export type { UserKeybindingsReport }

let cached: UserKeybindingsReport | null = null

/** Idempotent (cached report). Warnings also go to `console.warn` so they reach the log even if Settings → Keybindings is never opened. */
export function applyUserKeybindings(): UserKeybindingsReport {
  if (cached) return cached
  const { report, prefix } = resolveUserKeybindings(readKeybindingsFile(), RoveKeymap, process.platform)
  if (report.exists) configurePrefix(prefix)
  for (const w of report.warnings) console.warn(`[rove/keybindings] ${w}`)
  cached = report
  return cached
}

export function pluginKeybindings(): readonly PluginKeyBinding[] {
  return userKeybindingsReport().plugins
}

export function userKeybindingsReport(): UserKeybindingsReport {
  return cached ?? applyUserKeybindings()
}

/**
 * Live-reload counterpart of {@link applyUserKeybindings}, run when the daemon's
 * watcher pings the `keybindings` channel. Order matters: drop the file and
 * report caches, reset `RoveKeymap` to boot defaults, THEN re-apply, so a
 * removed override restores its default. The `keymapVersion` bump re-renders
 * legends; dispatch needs no nudge (it re-reads chords every keypress).
 */
export function reloadUserKeybindings(): UserKeybindingsReport {
  cached = null
  resetKeybindingsFileCache()
  resetKeymapToDefaults()
  resetPrefixConfiguration()
  const report = applyUserKeybindings()
  bumpKeymapVersion()
  return report
}

/**
 * Settings → Keybindings: write `edits` into the YAML (created from the starter when absent) and
 * reload. All or nothing: a refused edit leaves the file alone. `lines` are the refusal reasons,
 * or the loader's warnings about what was saved.
 */
export function saveKeybindingEdits(edits: readonly KeybindingEdit[]): { ok: boolean; lines: string[] } {
  resetKeybindingsFileCache()
  const file = readKeybindingsFile()
  const target = file.source ?? file.path
  const lines: string[] = []
  try {
    let text = file.source ? readFileSync(target, "utf8") : KEYBINDINGS_STARTER
    for (const edit of edits) {
      const result = editKeybindingsYaml(text, edit, defaultKeymapCopy(), process.platform)
      if (!result.ok) return { ok: false, lines: result.reasons }
      text = result.text
      for (const warning of result.warnings) if (!lines.includes(warning)) lines.push(warning)
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
  } catch (err) {
    return { ok: false, lines: [err instanceof Error ? err.message : String(err)] }
  }
  reloadUserKeybindings()
  return { ok: true, lines }
}
