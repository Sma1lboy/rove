/**
 * Droid (Factory CLI) hook adapter.
 *
 * Droid reads `~/.factory/settings.json`, and its hook document nests exactly
 * the way Claude's and Codex's do —
 * `{ "hooks": { "<Event>": [ { hooks: [ { type: "command", command } ] } ] } }`
 * Everything but the id, the table and the path comes from
 * {@link SessionStartHookAdapter} — read its module doc for why the table has
 * one entry and why the missing-directory guard is load-bearing.
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { SessionStartHookAdapter, sessionStartOnly } from "../session-hook-adapter.ts"

/** Droid hook event → normalized Rove verb. Droid's entries carry no matcher. */
export const DROID_HOOK_EVENT_MAP = sessionStartOnly()

/** Droid's config directory is `~/.factory`, with no env override: it is
 *  joined to the home directory and no variable is read. */
export function droidSettingsPath(home: string = homedir()): string {
  return join(home, ".factory", "settings.json")
}

export class DroidHookAdapter extends SessionStartHookAdapter {
  readonly vendor = "droid" as const
  protected readonly eventMap = DROID_HOOK_EVENT_MAP

  globalSettingsPath(): string {
    return droidSettingsPath()
  }
}
