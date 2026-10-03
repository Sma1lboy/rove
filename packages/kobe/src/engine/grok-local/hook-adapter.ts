/**
 * Grok CLI hook adapter.
 *
 * Grok reads its hook configuration by MERGING every `*.json` under
 * `<config dir>/hooks/`, which is why Rove owns a dedicated `rove.json` there
 * instead of editing a shared document: nothing Rove writes can collide with
 * the user's own hook files, and removal is a straight delete of our entries
 * from our own file. Inside that file the shape is the nested one Claude and
 * Codex use — `{ "hooks": { "<Event>": [ { hooks: [ { type, command } ] } ] } }`
 * — so the merge comes from {@link SessionStartHookAdapter} unchanged.
 *
 * Grok's config home is `$GROK_HOME`, defaulting to `~/.grok`; the CLI reads
 * `config.toml`, `auth.json` and `hooks/` from it, so an install that ignored
 * the variable would write where grok never looks.
 *
 * ONE event, deliberately. Grok's hooks report session identity reliably; its
 * working/blocked states are only legible on screen (permission dialogs, the
 * `[stop]` chip), so `../contrib-engines.ts`'s manifest keeps owning those and
 * the hook adds "which grok session is live in this worktree" on top — the
 * same split cursor landed on.
 */

import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { EngineSessionRef } from "../hook-adapter.ts"
import { SessionStartHookAdapter, sessionStartOnly } from "../session-hook-adapter.ts"

/** Grok hook event → normalized Rove verb. Grok's entries take no matcher. */
export const GROK_HOOK_EVENT_MAP = sessionStartOnly()

/** Grok's config home, honouring the CLI's own `GROK_HOME` override. */
export function grokConfigDir(home: string = homedir()): string {
  const override = process.env.GROK_HOME?.trim()
  return override || join(home, ".grok")
}

/** Rove's own file in grok's merged hooks directory. */
export function grokHooksPath(home: string = homedir()): string {
  return join(grokConfigDir(home), "hooks", "rove.json")
}

export class GrokHookAdapter extends SessionStartHookAdapter {
  readonly vendor = "grok" as const
  protected readonly eventMap = GROK_HOOK_EVENT_MAP

  globalSettingsPath(): string {
    return grokHooksPath()
  }

  /**
   * Guard on the CONFIG dir, not on `hooks/`: grok creates the subdirectory
   * only once something puts a hook file in it, so a fresh grok install has
   * `~/.grok` and no `~/.grok/hooks`. Guarding on the parent's parent is what
   * makes the first install land while still creating nothing on a machine
   * that never had grok.
   */
  protected override installGuardDir(settingsFilePath: string): string {
    return dirname(dirname(settingsFilePath))
  }

  /**
   * Grok's stdin payload spells the session id `sessionId`, alongside
   * `hookEventName`, `cwd` and `workspaceRoot`; `session_id` is read too for
   * the events that use the snake-case spelling. The same id is ALSO exported
   * to the hook process as `GROK_SESSION_ID`, which this payload-only seam
   * cannot see — it needs no widening for it, because the payload carries the
   * id on its own.
   */
  override sessionFromPayload(payload: Record<string, unknown>): EngineSessionRef | undefined {
    const sessionId = firstString(payload.session_id, payload.sessionId)
    if (!sessionId) return undefined
    const transcriptPath = firstString(payload.transcript_path, payload.transcriptPath)
    return { sessionId, ...(transcriptPath ? { transcriptPath } : {}) }
  }
}

function firstString(...values: readonly unknown[]): string | undefined {
  for (const value of values) if (typeof value === "string" && value) return value
  return undefined
}
