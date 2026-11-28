/**
 * Read-only counterpart to the hook installer: which engine settings files
 * would have their hook merge REFUSED right now, and why.
 *
 * The installer abandons a document it cannot understand
 * (`json-hooks.ts#parseHookSettings`), so a hand-edited `~/.claude/settings.json`
 * silently stops receiving hooks — badges just fall back to the daemon's ~10s
 * activity poll. This lets `rove doctor` name the file.
 *
 * Not in `cli/hook-cmd.ts`: a runtime import between CLI verb modules can land
 * as a bundle-only TDZ crash, invisible to tsc and unit tests.
 */

import { readFileSync } from "node:fs"
import { activityHookAdapters } from "./hook-adapter.ts"

/** A settings file the hook installer refused, and why. */
export interface HookConfigIssue {
  readonly file: string
  readonly reason: string
}

/**
 * Each adapter judges its OWN file: `hookConfigRefusal` is the read-only half
 * of that adapter's install, so doctor and the installer never disagree about
 * one file. An adapter with no such check (Kimi's TOML, the pi extension) is
 * skipped — one generic JSON validator would flag Cursor's valid `hooks.json`.
 *
 * Missing (first launch) or unreadable (install reports it) files aren't issues.
 */
export function hookConfigIssues(): HookConfigIssue[] {
  const issues: HookConfigIssue[] = []
  for (const adapter of activityHookAdapters()) {
    if (!adapter.hookConfigRefusal) continue
    const file = adapter.globalSettingsPath()
    if (!file) continue
    let raw: string
    try {
      raw = readFileSync(file, "utf8")
    } catch {
      continue
    }
    const reason = adapter.hookConfigRefusal(raw)
    if (reason) issues.push({ file, reason })
  }
  return issues
}
