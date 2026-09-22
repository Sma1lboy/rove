/**
 * Daemon-side watcher for the persisted UI prefs in the shared KV blob
 * (`~/.config/rove/state.json`, written by `packages/kobe/src/state/store.ts`).
 * A pane host that read them once at boot would miss a theme switch made in
 * another session, so this watches the file and publishes a `ui-prefs`
 * payload every subscribed pane applies live.
 *
 * Load-bearing mechanics:
 *   - **Match by basename, not the file's inode.** The store writes via
 *     tmp + rename, which swaps the inode.
 *   - **Stat-poll, not fs events** (`file-watch-trigger.ts`): macOS FSEvents
 *     arms asynchronously and permanently drops writes in its arm window.
 *   - **Debounce.** A write burst collapses into one read
 *     ~{@link DEFAULT_UI_PREFS_DEBOUNCE_MS} later.
 *   - **Changed-only publish.** A write that moved none of the payload's
 *     fields publishes nothing, so panes never re-apply on unrelated churn.
 *   - **Initial publish** warms the bus's last-value cache for late subscribers.
 *
 * Best-effort: missing/corrupt state reads as defaults; failures are logged
 * via `logDaemonError("ui-prefs-watcher", …)`, never fatal.
 */

import { readFileSync } from "node:fs"
import { basename } from "node:path"
import { logDaemonError } from "./crash-log.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import { startFileWatchTrigger } from "./file-watch-trigger.ts"
import { defaultUiPrefsStatePath } from "./product-paths.ts"
import type { UiPrefsPayload } from "./protocol.ts"

/** Default debounce between a state-file event and the read+publish. */
export const DEFAULT_UI_PREFS_DEBOUNCE_MS = 200

/**
 * Focus-accent slots the TUI understands — mirror of `FOCUS_ACCENT_SLOTS`
 * in `packages/kobe/src/tui/context/theme-core.ts`, not imported because
 * that module imports the OpenTUI renderer and the daemon must stay UI-free.
 */
const FOCUS_ACCENT_SLOT_NAMES = ["primary", "success", "info"] as const

/** Mirror of `THEME_MODE_PREFERENCES` in the same TUI module, for the same reason. */
const THEME_MODE_NAMES = ["dark", "light", "auto"] as const

// Re-exported for this module's importers; the TUI's `kvStatePath()` wraps it too.
export { defaultUiPrefsStatePath }

/**
 * Read the UI-pref keys out of the state file. Never throws — a missing /
 * corrupt file yields defaults (null theme, TRANSPARENT background, unset
 * accent, `default` sort, expanded keys legend, `en`). The theme NAME passes
 * through unvalidated; the TUI validates it against its registry.
 */
export function readUiPrefsFromStateFile(statePath: string): UiPrefsPayload {
  let parsed: Record<string, unknown> = {}
  try {
    const raw = JSON.parse(readFileSync(statePath, "utf8")) as unknown
    if (raw && typeof raw === "object" && !Array.isArray(raw)) parsed = raw as Record<string, unknown>
  } catch {
    // Defaults: the channel must always have a sane value to replay.
  }
  // `null`, not `"claude"`: only the TUI's theme registry knows the default.
  const theme = typeof parsed.activeTheme === "string" && parsed.activeTheme.length > 0 ? parsed.activeTheme : null
  const themeMode =
    typeof parsed.themeMode === "string" && (THEME_MODE_NAMES as readonly string[]).includes(parsed.themeMode)
      ? parsed.themeMode
      : null
  // Default-true: only an explicit stored `false` opts out.
  const transparentBackground = parsed.transparentBackground !== false
  const focusAccent =
    typeof parsed.focusAccent === "string" &&
    (FOCUS_ACCENT_SLOT_NAMES as readonly string[]).includes(parsed.focusAccent)
      ? parsed.focusAccent
      : null
  // Mirror of the TUI's `TaskSortMode` union; anything else is `default`.
  const sortMode =
    parsed.activeSortMode === "recent" || parsed.activeSortMode === "attention" ? parsed.activeSortMode : "default"
  // Tasks-pane keys legend fold: only an explicit `true` collapses.
  const keysCollapsed = parsed["tasksPane.keysCollapsed"] === true
  const projectFilter =
    typeof parsed["tasksPane.projectFilter"] === "string" && parsed["tasksPane.projectFilter"].length > 0
      ? parsed["tasksPane.projectFilter"]
      : null
  // Opaque language id; the TUI validates it (unknown → English).
  const locale = typeof parsed.locale === "string" && parsed.locale.length > 0 ? parsed.locale : "en"
  return { theme, themeMode, transparentBackground, focusAccent, locale, sortMode, keysCollapsed, projectFilter }
}

function samePrefs(a: UiPrefsPayload, b: UiPrefsPayload): boolean {
  return (
    a.theme === b.theme &&
    a.themeMode === b.themeMode &&
    a.transparentBackground === b.transparentBackground &&
    a.focusAccent === b.focusAccent &&
    a.locale === b.locale &&
    a.sortMode === b.sortMode &&
    a.keysCollapsed === b.keysCollapsed &&
    a.projectFilter === b.projectFilter
  )
}

export interface UiPrefsWatcherOptions {
  /** State-file path to watch. Defaults to {@link defaultUiPrefsStatePath}. */
  readonly statePath?: string
  /**
   * Debounce between a file event and the read+publish. `<= 0` disables
   * the watcher entirely (no-op stop, publishes nothing).
   */
  readonly debounceMs?: number
}

/**
 * Start the watcher: publish the current prefs immediately (replay seed),
 * then re-read + publish-on-change after every debounced state-file event.
 * Returns the file-watch trigger's `stop()`.
 */
export function startUiPrefsWatcher(bus: DaemonEventBus, options: UiPrefsWatcherOptions = {}): () => void {
  const debounceMs = options.debounceMs ?? DEFAULT_UI_PREFS_DEBOUNCE_MS
  if (debounceMs <= 0) return () => {}
  const statePath = options.statePath ?? defaultUiPrefsStatePath()
  const stateFile = basename(statePath)

  let last: UiPrefsPayload | null = null

  const publishIfChanged = (): void => {
    try {
      const next = readUiPrefsFromStateFile(statePath)
      if (last && samePrefs(last, next)) return
      last = next
      bus.publish("ui-prefs", next)
    } catch (err) {
      logDaemonError("ui-prefs-watcher", err)
    }
  }
  // Watch BEFORE the initial read: the baseline stamp is taken synchronously,
  // so no write can fall between it and the initial publish.
  const stop = startFileWatchTrigger({
    filePath: statePath,
    matchBasenames: [stateFile],
    debounceMs,
    onTrigger: publishIfChanged,
    onError: (err) => logDaemonError("ui-prefs-watcher", err),
  })
  // Always publishes (`last` is null). If the poll never fires, panes keep
  // boot-time prefs — the documented degraded mode.
  publishIfChanged()
  return stop
}
