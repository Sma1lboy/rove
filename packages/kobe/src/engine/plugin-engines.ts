/**
 * Load `[[engines]]` from enabled plugin manifests into the contrib-engine
 * table — the plugin half of the engine seam. Read-only over the plugin
 * registry (the daemon's plugins.json) + each enabled plugin's manifest;
 * translation is manifest `PluginEngine` → `ContribEngineSpec` (the same
 * data shape the shipped catalog uses, so everything downstream — selector
 * gating, launch, screen badges, display names — is already wired).
 *
 * Called once at process start (TUI boot, next to hook install). Best-effort
 * by contract: a broken plugin manifest must never block a launch — it just
 * contributes no engine.
 */

import { readPluginManifest } from "@sma1lboy/kobe-daemon/plugins/manifest"
import { loadPluginRegistry } from "@sma1lboy/kobe-daemon/plugins/registry"
import { registerPluginEngine } from "./contrib-engines.ts"

/** Load engines from every enabled plugin. Returns the registered ids. */
export function loadPluginEngines(): readonly string[] {
  const registered: string[] = []
  try {
    for (const entry of loadPluginRegistry().plugins) {
      if (!entry.enabled) continue
      try {
        const { manifest } = readPluginManifest(entry.root)
        for (const engine of manifest.engines) {
          const ok = registerPluginEngine(engine.id, {
            displayName: engine.name,
            defaultCommand: engine.command,
            ...(engine.processNames ? { processNames: engine.processNames } : {}),
            screenManifest: { rules: engine.rules },
          })
          if (ok) registered.push(engine.id)
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
