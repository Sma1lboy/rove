/**
 * Watches `~/.rove/settings/keybindings.yaml` and bumps a `rev` on the
 * `keybindings` channel. The TUI applies overrides once at boot, so this is
 * the "re-read now" ping to every session; panes re-read the file themselves.
 *
 * Mechanics as `ui-prefs-watcher.ts` (watch the DIRECTORY to survive
 * tmp+rename, debounce, never fatal), but no changed-only compare: the daemon
 * deliberately doesn't parse the YAML, so a no-op edit costs one harmless
 * re-apply per pane.
 */

import { basename } from "node:path"
import { logDaemonError } from "./crash-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import { startFileWatchTrigger } from "./file-watch-trigger.ts"
import { defaultKeybindingsPath } from "./product-paths.ts"

export const DEFAULT_KEYBINDINGS_DEBOUNCE_MS = 200

// Importers (collectors, tests) address the path via the watcher.
export { defaultKeybindingsPath }

export interface KeybindingsWatcherOptions {
  /** Keybindings file path to watch. Defaults to {@link defaultKeybindingsPath}. */
  readonly path?: string
  /** `<= 0` disables the watcher entirely (no-op stop, publishes nothing). */
  readonly debounceMs?: number
}

/** Publishes an initial `rev` as the replay seed, then one per debounced file event. */
export function startKeybindingsWatcher(bus: DaemonEventBus, options: KeybindingsWatcherOptions = {}): () => void {
  const debounceMs = options.debounceMs ?? DEFAULT_KEYBINDINGS_DEBOUNCE_MS
  if (debounceMs <= 0) return () => {}
  const filePath = options.path ?? defaultKeybindingsPath()
  const baseYaml = basename(filePath)
  const baseYml = baseYaml.replace(/\.yaml$/, ".yml")

  // Only CHANGES of `rev` mean anything (each bump = "re-read").
  let rev = 0
  bus.publish("keybindings", { rev })

  const bump = (): void => {
    try {
      rev += 1
      bus.publish("keybindings", { rev })
    } catch (err) {
      logDaemonError("keybindings-watcher", err)
    }
  }

  // No watcher → panes keep boot-time keybindings (documented degraded mode).
  return startFileWatchTrigger({
    filePath,
    matchBasenames: [baseYaml, baseYml],
    debounceMs,
    onTrigger: bump,
    onError: (err) => logDaemonError("keybindings-watcher", err),
  })
}
