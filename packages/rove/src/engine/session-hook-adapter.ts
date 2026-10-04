/**
 * The shape three catalog engines share: a Claude-shaped `settings.json`, one
 * `SessionStart` observer, and nothing else.
 *
 * Droid, qodercli and devin read the same nested hook document as Claude and
 * Codex, so {@link JsonHookAdapter} owns their merge. This class adds:
 *
 *  - **The missing-directory guard.** These ride the default-on launch
 *    installer, so without it every machine would grow `~/.factory`,
 *    `~/.qoder` and `~/.config/devin` for CLIs it doesn't have.
 *  - **`session_id` / `transcript_path`.** `session_id` only when a non-empty
 *    string (else give up, don't guess); the transcript field is unverified
 *    for all three, so read only when present, never invented.
 *
 * One event each: their lifecycle events aren't a verified authority for turn
 * state, so each screen manifest owns working/blocked/idle and the hook only
 * adds session identity (the split cursor uses).
 *
 * Subclasses supply an id, a table and a path; merge logic stays in
 * `./json-hooks.ts` behind {@link JsonHookAdapter}.
 */

import { existsSync } from "node:fs"
import { dirname } from "node:path"
import type { VendorId } from "../types/vendor.ts"
import type { EngineSessionRef } from "./hook-adapter.ts"
import { JsonHookAdapter } from "./json-hook-adapter.ts"
import type { HookEditOutcome, HookEventSpec } from "./json-hooks.ts"

/** The one-entry table each of these engines declares. `matcher` is the
 *  vendor's own convention — qodercli's settings mirror Claude's closely
 *  enough to take the `"*"` wildcard, and droid/devin take none. */
export function sessionStartOnly(matcher?: string): readonly HookEventSpec[] {
  return [{ event: "SessionStart", verb: "session-start", ...(matcher ? { matcher } : {}) }]
}

export abstract class SessionStartHookAdapter extends JsonHookAdapter {
  abstract override readonly vendor: VendorId

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
