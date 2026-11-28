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

import { type UserKeybindingsReport, resolveUserKeybindings } from "@sma1lboy/rove-client/keys/keybindings-resolve.ts"
import { type KeybindingSaveResult, writeKeybindingEdits } from "@sma1lboy/rove-client/keys/keybindings-save.ts"
import type { KeybindingEdit } from "@sma1lboy/rove-client/keys/keybindings-write.ts"
import { RoveKeymap, bumpKeymapVersion, resetKeymapToDefaults } from "@sma1lboy/rove-client/keys/keybindings.ts"
import { configurePrefix, resetPrefixConfiguration } from "@sma1lboy/rove-client/keys/keymap-dispatch.ts"
import type { PluginKeyBinding } from "@sma1lboy/rove-client/keys/keymap-plugin-bindings.ts"
import { readKeybindingsFile, resetKeybindingsFileCache } from "@sma1lboy/rove-core/state/keybindings-file.ts"

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

/** Settings → Keybindings: save `edits` to the YAML and reload the live keymap. */
export function saveKeybindingEdits(edits: readonly KeybindingEdit[]): KeybindingSaveResult {
  const result = writeKeybindingEdits(edits)
  if (result.ok) reloadUserKeybindings()
  return result
}
