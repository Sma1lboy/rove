/**
 * Loads `~/.rove/settings/keybindings.yaml` (via `src/state/keybindings-file.ts`;
 * the CLI always runs under Bun, so `Bun.YAML` exists) and MUTATES the matching
 * `KobeKeymap` rows in place for `process.platform`. Panes register through
 * `bindByIds`/`chordsOf` and legends render from the table, so one boot-time
 * mutation re-points every surface.
 *
 * Call `applyUserKeybindings()` ONCE per process BEFORE the first `render()`
 * (same slot as `loadUserThemes()`). Idempotent, never throws; a missing file
 * is the normal fresh-install case. Not applied at import: unit tests must see
 * pristine defaults whatever the developer's own file says.
 */

import { readKeybindingsFile, resetKeybindingsFileCache } from "../../state/keybindings-file"
import { DEFAULT_PREFIX_CONFIGURATION, configurePrefix, resetPrefixConfiguration } from "../lib/keymap-dispatch"
import { type AppliedOverride, applyKeymapOverrides, extractKeybindingOverrides } from "../lib/keymap-overrides"
import { type PluginKeyBinding, extractPluginKeybindings } from "../lib/keymap-plugin-bindings"
import { applyPrefixKeymapOverrides, extractPrefixKeybindings } from "../lib/keymap-prefix-overrides"
import { KobeKeymap, bumpKeymapVersion, resetKeymapToDefaults } from "./keybindings"

export type UserKeybindingsReport = {
  /** Canonical config path (the `.yaml` spelling, even when `.yml` was read). */
  path: string
  /** Whether a config file was found at all. */
  exists: boolean
  /** Overrides that landed in the workspace keymap. */
  applied: AppliedOverride[]
  /** User chords bound to plugin panes/actions (`plugins:` section). */
  plugins: PluginKeyBinding[]
  /** Everything that didn't parse / validate / apply, human-readable. */
  warnings: string[]
}

let cached: UserKeybindingsReport | null = null

/** Idempotent (cached report). Warnings also go to `console.warn` so they reach the log even if Settings → Keybindings is never opened. */
export function applyUserKeybindings(): UserKeybindingsReport {
  if (cached) return cached
  const file = readKeybindingsFile()
  if (!file.exists) {
    cached = { path: file.path, exists: false, applied: [], plugins: [], warnings: [] }
    return cached
  }

  const warnings: string[] = [...file.warnings]
  const extracted = extractKeybindingOverrides(file.doc, process.platform)
  warnings.push(...extracted.warnings)
  const prefix = extractPrefixKeybindings(file.doc, process.platform)
  warnings.push(...prefix.warnings)
  configurePrefix({ ...DEFAULT_PREFIX_CONFIGURATION, ...prefix.configuration })

  const result = applyKeymapOverrides(KobeKeymap, extracted.entries)
  warnings.push(...result.warnings)
  const applied: AppliedOverride[] = [...result.applied]
  const prefixKey = prefix.configuration.key
  if (prefixKey !== null && prefixKey !== undefined) {
    const directOwner = KobeKeymap.find((row) => row.keys.includes(prefixKey))
    if (directOwner) warnings.push(`prefix.key "${prefixKey}" collides with direct binding ${directOwner.id}`)
  }
  const prefixResult = applyPrefixKeymapOverrides(KobeKeymap, [...extracted.prefixEntries, ...prefix.entries])
  warnings.push(...prefixResult.warnings)
  applied.push(...prefixResult.applied)

  // Collisions with catalogue chords are the user's call: warn but apply
  // (host-level plugin bindings sit above pane bindings in the stack).
  const plugins = extractPluginKeybindings(file.doc, process.platform)
  warnings.push(...plugins.warnings)
  for (const p of plugins.entries) {
    const owner = KobeKeymap.find((row) => row.keys.includes(p.chord))
    if (owner) warnings.push(`plugins: ${p.chord} shadows ${owner.id}`)
  }

  for (const w of warnings) console.warn(`[rove/keybindings] ${w}`)
  cached = { path: file.path, exists: true, applied, plugins: plugins.entries, warnings }
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
 * report caches, reset `KobeKeymap` to boot defaults, THEN re-apply, so a
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
