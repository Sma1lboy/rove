/**
 * Devin CLI hook adapter.
 *
 * Devin reads the Claude-shaped hook document from `~/.config/devin/config.json`
 * (XDG, and not named `settings.json`). All but id, table and path comes from
 * {@link SessionStartHookAdapter}.
 *
 * Of Devin's six identity-carrying events (`SessionStart`, `UserPromptSubmit`,
 * `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`), Rove wires only
 * `SessionStart`: identity is needed once, and re-firing on every tool call
 * would re-reduce activity state all turn. `PermissionRequest` is also a
 * DECISION hook that gates the agent — Codex and Cursor leave it alone too.
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { SessionStartHookAdapter, sessionStartOnly } from "../session-hook-adapter.ts"

/** Devin hook event → normalized Rove verb. Devin's entries carry no matcher. */
export const DEVIN_HOOK_EVENT_MAP = sessionStartOnly()

/** Devin's config directory follows XDG: `$XDG_CONFIG_HOME/devin`, else
 *  `~/.config/devin`. The file is `config.json`. */
export function devinSettingsPath(home: string = homedir()): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim()
  return join(xdg || join(home, ".config"), "devin", "config.json")
}

export class DevinHookAdapter extends SessionStartHookAdapter {
  readonly vendor = "devin" as const
  protected readonly eventMap = DEVIN_HOOK_EVENT_MAP

  globalSettingsPath(): string {
    return devinSettingsPath()
  }
}
