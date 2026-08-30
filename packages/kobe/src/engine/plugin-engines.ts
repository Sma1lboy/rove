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
          // Identity falls back per-field to the engine's display name — a
          // plugin declaring nothing still gets sensible composer copy.
          const identity = {
            vendorId: engine.id,
            productName: engine.identity?.productName ?? engine.name,
            shortName: engine.identity?.shortName ?? engine.name,
            assistantName: engine.identity?.assistantName ?? engine.name,
            inputPlaceholder: engine.identity?.inputPlaceholder ?? `Ask ${engine.identity?.shortName ?? engine.name}…`,
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
  resetAvailableVendorsCache()
  return registered
}
