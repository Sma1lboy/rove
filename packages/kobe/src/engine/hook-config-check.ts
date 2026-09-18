/**
 * Read-only counterpart to the hook installer: which engine settings files
 * would have their hook merge REFUSED right now, and why.
 *
 * The installer abandons a document it cannot understand
 * (`json-hooks.ts#parseHookSettings`) so a best-effort write never clobbers an
 * engine configuration — correct, but it means a hand-edited
 * `~/.claude/settings.json` permanently stops receiving hooks. The only
 * symptom is latency: every badge falls back to the daemon's ~10s activity
 * poll. This is the module that lets `rove doctor` name the file instead.
 *
 * Its own file rather than `cli/hook-cmd.ts` so `doctor-cmd` does not take a
 * runtime edge on another CLI verb's module — that class of import lands as a
 * bundle-only TDZ crash in a neighbouring verb, invisible to tsc and unit
 * tests.
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
 * one file. An adapter that declares no such check (Kimi's TOML block, the pi
 * family's extension module) is simply not checked — the alternative, running
 * one JSON validator over every hook file whose name ends `.json`, reported
 * Cursor's perfectly valid `hooks.json` as broken for having its own shape.
 *
 * A missing file is the first-launch case, and one that cannot be read at all
 * is a permissions problem the install reports itself — neither is an issue.
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
