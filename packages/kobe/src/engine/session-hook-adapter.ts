/**
 * The shape three catalog engines share: a Claude-shaped `settings.json`, one
 * `SessionStart` observer, and nothing else.
 *
 * Droid, qodercli and devin all read the nested hook document Claude and Codex
 * read, so {@link JsonHookAdapter} already owns their merge. What each of them ALSO
 * needs, and what Claude and Codex do not, is on this class:
 *
 *  - **The missing-directory guard.** Claude and Codex are only ever installed
 *    into homes whose CLI already owns the directory. These three ride the
 *    default-on launch installer like every other engine, so without the guard
 *    every machine in the world would grow a `~/.factory`, a `~/.qoder` and a
 *    `~/.config/devin` for CLIs that will never read them.
 *  - **`session_id` / `transcript_path`.** `session_id` is taken only when it
 *    is a non-empty string, and the adapter gives up rather than guessing when
 *    it is not; the transcript field is unverified for all three, so it is read
 *    only when present and never invented.
 *
 * Why one event each. The lifecycle events these three expose are not a
 * verified authority for turn state, so each engine's screen manifest keeps
 * owning working/blocked/idle and the hook adds session identity on top, the
 * split cursor landed on first.
 *
 * Subclasses supply an id, a table and a path; nothing here is Rove's merge
 * logic, which stays in `./json-hooks.ts` behind {@link JsonHookAdapter}.
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
