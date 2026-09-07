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
import { ALL_VENDORS } from "../types/vendor.ts"
import { createEngineHookAdapter } from "./hook-adapter.ts"
import { parseHookSettings } from "./json-hooks.ts"

/** A settings file the hook installer refused, and why. */
export interface HookConfigIssue {
  readonly file: string
  readonly reason: string
}

/**
 * Only JSON-shaped settings are checked: `parseHookSettings` is that format's
 * validator, and the TOML adapter (Kimi) carries its own. A missing file is
 * the first-launch case, and one that cannot be read at all is a permissions
 * problem the install reports itself — neither is an issue here.
 */
export function hookConfigIssues(): HookConfigIssue[] {
  const issues: HookConfigIssue[] = []
  for (const vendor of ALL_VENDORS) {
    const adapter = createEngineHookAdapter(vendor)
    if (!adapter.supportsHooks()) continue
    const file = adapter.globalSettingsPath()
    if (!file || !file.endsWith(".json")) continue
    let raw: string
    try {
      raw = readFileSync(file, "utf8")
    } catch {
      continue
    }
    const parsed = parseHookSettings(raw)
    if (!parsed.ok) issues.push({ file, reason: parsed.reason })
  }
  return issues
}
