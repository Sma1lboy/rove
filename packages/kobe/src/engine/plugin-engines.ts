/**
 * Load `[[engines]]` from enabled plugin manifests into the contrib-engine
 * table, as `ContribEngineSpec` (the shipped catalog's shape, so everything
 * downstream is already wired). Read-only over the plugin registry and
 * manifests. Best-effort: a broken manifest contributes no engine, never
 * blocks a launch.
 */

import { readPluginManifest } from "@sma1lboy/kobe-daemon/plugins/manifest"
import { loadPluginRegistry } from "@sma1lboy/kobe-daemon/plugins/registry"
import { getCustomEngineIds } from "../state/repos.ts"
import { resetAvailableVendorsCache } from "./account-detect.ts"
import { CONTRIB_ENGINE_IDS, clearPluginEngines, registerPluginEngine } from "./contrib-engines.ts"

/** Load engines from every enabled plugin; returns the registered ids. */
export function loadPluginEngines(homeDir?: string): readonly string[] {
  const registered: string[] = []
  try {
    for (const entry of loadPluginRegistry(homeDir).plugins) {
      if (!entry.enabled) continue
      try {
        const { manifest } = readPluginManifest(entry.root)
        for (const engine of manifest.engines) {
          const identity = {
            shortName: engine.identity?.shortName ?? engine.name,
          }
          const ok = registerPluginEngine(engine.id, {
            displayName: engine.name,
            defaultCommand: engine.command,
            ...(engine.processNames ? { processNames: engine.processNames } : {}),
            screenManifest: { rules: engine.rules },
            identity,
            ...(engine.firstMessageDelivery ? { firstMessageDelivery: engine.firstMessageDelivery } : {}),
          })
          if (ok) {
            registered.push(engine.id)
          } else {
            // Otherwise the shipped engine of the same name masks the plugin silently.
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
 * (Settings → Plugins). The contrib table and the binary-discovery memo are
 * per-process, so stale entries would otherwise survive until restart.
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
 * Load plugin engines once per process. The CLI has no boot step like the
 * TUI's, so every `api` surface that must agree with `engine-list` (flag
 * gates, `schema`, `--command` protocol resolution) goes through this.
 */
export function ensurePluginEnginesLoaded(): readonly string[] {
  loadedOnce ??= loadPluginEngines()
  return loadedOnce
}

/**
 * Every engine id a user may name that is not a BUILT-IN: the shipped contrib
 * catalog, the custom presets in state.json, and the engines enabled plugins
 * contribute.
 *
 * The `api` flag gates consult this so `--vendor` / `--agents` / `schema`
 * accept exactly what `engine-list` advertises.
 *
 * No PATH probe (unlike `engine-list`): `--vendor` names the adapter, not an
 * installed binary, and a missing CLI fails at spawn with a better error.
 *
 * Loading plugin engines is a deliberate side effect: registering makes the
 * protocol resolver name the engine, so a task records it instead of `generic`.
 */
export function registeredEngineIds(): readonly string[] {
  return [...new Set([...CONTRIB_ENGINE_IDS, ...getCustomEngineIds(), ...ensurePluginEnginesLoaded()])]
}
