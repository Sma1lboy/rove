/**
 * Droid (Factory CLI) hook adapter — the A layer for a contrib catalog entry,
 * and the third engine on the Claude/Codex settings shape.
 *
 * Droid reads `~/.factory/settings.json`, and its hook document nests exactly
 * the way Claude's and Codex's do —
 * `{ "hooks": { "<Event>": [ { matcher?, hooks: [ { type: "command", command } ] } ] } }`
 * (refs/herdr `src/integration/targets.rs#install_droid`, which builds entries
 * through the same `ensure_command_hook` it uses for the Claude-shaped
 * engines). So this adapter inherits every merge/IO mechanic from
 * {@link JsonHookAdapter} and supplies three things: its vendor id, its
 * event→verb table, and its settings path — plus one override, the guard that
 * keeps a machine without droid untouched.
 *
 * `SessionStart` is the whole table, deliberately. Droid is absent from
 * herdr's `full_lifecycle_hook_authority()` set, and herdr itself retreated
 * from the nine lifecycle events it once installed to this one
 * (`DROID_REMOVED_LIFECYCLE_HOOK_EVENTS`, which it now deletes on sight). So
 * the {@link DROID} screen manifest keeps owning working/blocked/idle exactly
 * as before and the hook adds session identity on top — the same split cursor
 * and copilot land on.
 */

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { EngineSessionRef } from "../hook-adapter.ts"
import { JsonHookAdapter } from "../json-hook-adapter.ts"
import type { HookEditOutcome, HookEventSpec } from "../json-hooks.ts"

/** Droid hook event → normalized Rove verb. See the module doc for why the
 *  rest of droid's event vocabulary stays unhooked. */
export const DROID_HOOK_EVENT_MAP: readonly HookEventSpec[] = [{ event: "SessionStart", verb: "session-start" }]

/** Droid's config directory is `~/.factory`, with no env override — herdr's
 *  `droid_dir()` joins it to the home directory and reads no variable. */
export function droidSettingsPath(home: string = homedir()): string {
  return join(home, ".factory", "settings.json")
}

export class DroidHookAdapter extends JsonHookAdapter {
  readonly vendor = "droid" as const
  protected readonly eventMap = DROID_HOOK_EVENT_MAP

  globalSettingsPath(): string {
    return droidSettingsPath()
  }

  /**
   * No `~/.factory` means droid was never installed here. The base class has
   * no such guard because Claude and Codex are only ever installed into homes
   * their CLI already owns; droid rides the default-on launch installer like
   * the rest, so without this every machine in the world would grow a
   * `~/.factory/settings.json` for a CLI that will never read it.
   */
  override async installActivityHooks(
    settingsFilePath: string,
    opts: { toolEvents?: boolean; quiet?: boolean } = {},
  ): Promise<HookEditOutcome> {
    if (!existsSync(dirname(settingsFilePath))) return { ok: true }
    return super.installActivityHooks(settingsFilePath, opts)
  }

  override async removeActivityHooks(settingsFilePath: string): Promise<void> {
    if (!existsSync(settingsFilePath)) return
    await super.removeActivityHooks(settingsFilePath)
  }

  /** Droid's `SessionStart` payload spells the id `session_id` (refs/herdr's
   *  droid hook reads that key and exits when it is not a non-empty string).
   *  The transcript field is unverified, so it is read only when present and
   *  never invented. */
  override sessionFromPayload(payload: Record<string, unknown>): EngineSessionRef | undefined {
    if (typeof payload.session_id !== "string" || !payload.session_id) return undefined
    return {
      sessionId: payload.session_id,
      ...(typeof payload.transcript_path === "string" && payload.transcript_path
        ? { transcriptPath: payload.transcript_path }
        : {}),
    }
  }
}
