/**
 * Devin CLI hook adapter.
 *
 * Devin reads `~/.config/devin/config.json` — an XDG path, and the only one of
 * these four engines whose hook file is not called `settings.json` — with the
 * nested Claude-shaped hook document (refs/herdr
 * `src/integration/targets.rs#install_devin`, which builds entries through the
 * same `ensure_command_hook` as the other Claude-shaped engines). Everything
 * but the id, the table and the path comes from
 * {@link SessionStartHookAdapter}.
 *
 * Devin is the one engine of the four where herdr still registers SIX events
 * (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
 * `PermissionRequest`, `Stop`) — but all six fire the same `session` action,
 * i.e. they re-report the identity of a session herdr already knows. Rove
 * wires only `SessionStart`: the daemon needs a session's identity once, and
 * firing `session-start` again on every tool call would re-reduce the task's
 * activity state all turn long for no new information. The other five stay
 * unhooked, `PermissionRequest` also because it is a DECISION hook whose
 * answer gates the agent — the same one Codex and Cursor leave alone.
 */

import { homedir } from "node:os"
import { join } from "node:path"
import { SessionStartHookAdapter, sessionStartOnly } from "../session-hook-adapter.ts"

/** Devin hook event → normalized Rove verb. Devin's entries carry no matcher. */
export const DEVIN_HOOK_EVENT_MAP = sessionStartOnly()

/** Devin's config directory follows XDG: `$XDG_CONFIG_HOME/devin`, else
 *  `~/.config/devin` (herdr's `devin_dir()`). The file is `config.json`. */
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
