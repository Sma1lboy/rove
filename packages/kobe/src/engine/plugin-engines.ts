/**
 * Load `[[engines]]` from enabled plugin manifests into the contrib-engine
 * table — the plugin half of the engine seam. Read-only over the plugin
 * registry (the daemon's plugins.json) + each enabled plugin's manifest;
 * translation is manifest `PluginEngine` → `ContribEngineSpec` (the same
 * data shape the shipped catalog uses, so everything downstream — selector
 * gating, launch, screen badges, display names — is already wired).
 *
 * Called at process start (TUI boot, next to hook install) and again from
 * the Settings → Plugins toggle so enabling/disabling an engine plugin
 * takes effect without a restart. Best-effort by contract: a broken plugin
 * manifest must never block a launch — it just contributes no engine.
 */

import { readPluginManifest } from "@sma1lboy/kobe-daemon/plugins/manifest"
import { loadPluginRegistry } from "@sma1lboy/kobe-daemon/plugins/registry"
import { getCustomEngineIds } from "../state/repos.ts"
import { resetAvailableVendorsCache } from "./account-detect.ts"
import { clearPluginEngines, registerPluginEngine } from "./contrib-engines.ts"

/**
 * Load engines from every enabled plugin. Returns the registered ids.
 * `homeDir` is a test seam (a throwaway plugin registry); production reads
 * the user's registry.
 */
export function loadPluginEngines(homeDir?: string): readonly string[] {
  const registered: string[] = []
  try {
    for (const entry of loadPluginRegistry(homeDir).plugins) {
      if (!entry.enabled) continue
      try {
        const { manifest } = readPluginManifest(entry.root)
        for (const engine of manifest.engines) {
          // shortName falls back to the engine's display name — a plugin
          // declaring nothing still gets a sensible label.
          const identity = {
            vendorId: engine.id,
            shortName: engine.identity?.shortName ?? engine.name,
          }
          const ok = registerPluginEngine(engine.id, {
            displayName: engine.name,
            defaultCommand: engine.command,
            ...(engine.processNames ? { processNames: engine.processNames } : {}),
            screenManifest: { rules: engine.rules },
            identity,
          })
          if (ok) {
            registered.push(engine.id)
          } else {
            // Without this the engine vanishes with no trace — the user sees
            // the shipped engine of the same name and thinks the plugin works.
            console.warn(
              `[rove] plugin ${entry.id}: engine id \`${engine.id}\` shadows a built-in or shipped engine — skipped`,
            )
          }
        }
      } catch {
        /* unreadable manifest → contributes no engines */
      }
    }
  } catch {
    /* registry unreadable → no plugin engines */
  }
  return registered
}

/**
 * Re-read plugin engines after the registry changed under a running TUI
 * (the Settings → Plugins toggle). The contrib table and the selector's
 * binary-discovery memo are both per-process state, so a stale entry would
 * otherwise survive until restart — in BOTH directions (newly enabled
 * engines missing, newly disabled ones still offered).
 */
export function reloadPluginEngines(homeDir?: string): readonly string[] {
  clearPluginEngines()
  const registered = loadPluginEngines(homeDir)
  loadedOnce = registered
  resetAvailableVendorsCache()
  return registered
}

/** Memo for {@link ensurePluginEnginesLoaded}; {@link reloadPluginEngines} refreshes it. */
let loadedOnce: readonly string[] | undefined

/**
 * Load plugin engines once per process. The TUI does it eagerly at boot; the
 * CLI has no such step, so every `api` surface that must AGREE with
 * `engine-list` — the flag gates, `schema`, and the protocol a `--command`
 * resolves to — goes through this instead of re-reading the registry each time.
 */
export function ensurePluginEnginesLoaded(): readonly string[] {
  loadedOnce ??= loadPluginEngines()
  return loadedOnce
}

/**
 * Every engine id a user may name that is not a BUILT-IN: the custom presets
 * in state.json plus the engines enabled plugins contribute.
 *
 * The `api` flag gates consult this so `--vendor` / `--agents` / `schema`
 * accept exactly what `engine-list` advertises. They used to read only the
 * custom presets, so a plugin engine was rejected by an error message that
 * told the agent to go look at `engine-list` — where it was listed.
 *
 * Loading plugin engines is a deliberate side effect: unlike the TUI, the CLI
 * has no boot step that registers them, and registering makes the protocol
 * resolver name the engine too, so a task created with one records that engine
 * instead of `generic`.
 */
export function registeredEngineIds(): readonly string[] {
  return [...getCustomEngineIds(), ...ensurePluginEnginesLoaded()]
}
