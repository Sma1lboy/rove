/**
 * The whole of `~/.rove/settings/keybindings.yaml` resolved against a keymap
 * as one pure step: direct and prefix overrides, the prefix key, plugin chords
 * and every warning. The TUI runs it on `RoveKeymap` at boot and on live
 * reload (`context/keybindings-user.ts`); the web bridge runs it on a copy so
 * both clients read the same parser's result. Mutates only the rows it is
 * given; no module state, no console output.
 */

import type { KeybindingsFile } from "../../state/keybindings-file"
import { DEFAULT_PREFIX_CONFIGURATION, type PrefixConfiguration, prefixFirstStrokes } from "./keymap-dispatch"
import {
  type AppliedOverride,
  type OverridableBinding,
  applyKeymapOverrides,
  extractKeybindingOverrides,
} from "./keymap-overrides"
import { type PluginKeyBinding, extractPluginKeybindings } from "./keymap-plugin-bindings"
import { applyPrefixKeymapOverrides, extractPrefixKeybindings } from "./keymap-prefix-overrides"

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

export type ResolvedKeybindings = {
  report: UserKeybindingsReport
  /** The prefix configuration the file asks for (the default when it says nothing). */
  prefix: PrefixConfiguration
}

export function resolveUserKeybindings(
  file: Pick<KeybindingsFile, "path" | "exists" | "doc" | "warnings">,
  keymap: readonly OverridableBinding[],
  platform: NodeJS.Platform,
): ResolvedKeybindings {
  if (!file.exists) {
    return {
      report: { path: file.path, exists: false, applied: [], plugins: [], warnings: [] },
      prefix: { ...DEFAULT_PREFIX_CONFIGURATION },
    }
  }

  const warnings: string[] = [...file.warnings]
  const extracted = extractKeybindingOverrides(file.doc, platform)
  warnings.push(...extracted.warnings)
  const prefix = extractPrefixKeybindings(file.doc, platform)
  warnings.push(...prefix.warnings)
  const prefixConfiguration: PrefixConfiguration = { ...DEFAULT_PREFIX_CONFIGURATION, ...prefix.configuration }

  const result = applyKeymapOverrides(keymap, extracted.entries)
  warnings.push(...result.warnings)
  const applied: AppliedOverride[] = [...result.applied]
  const customPrefix = prefix.configuration.key === undefined ? [] : prefixFirstStrokes(prefixConfiguration)
  for (const prefixKey of customPrefix) {
    const directOwner = keymap.find((row) => row.keys.includes(prefixKey))
    if (directOwner) warnings.push(`prefix.key "${prefixKey}" collides with direct binding ${directOwner.id}`)
  }
  const prefixResult = applyPrefixKeymapOverrides(keymap, [...extracted.prefixEntries, ...prefix.entries])
  warnings.push(...prefixResult.warnings)
  applied.push(...prefixResult.applied)

  // Collisions with catalogue chords are the user's call: warn but apply
  // (host-level plugin bindings sit above pane bindings in the stack).
  const plugins = extractPluginKeybindings(file.doc, platform)
  warnings.push(...plugins.warnings)
  for (const p of plugins.entries) {
    const owner = keymap.find((row) => row.keys.includes(p.chord))
    if (owner) warnings.push(`plugins: ${p.chord} shadows ${owner.id}`)
  }

  return {
    report: { path: file.path, exists: true, applied, plugins: plugins.entries, warnings },
    prefix: prefixConfiguration,
  }
}
