/**
 * GitHub Copilot CLI hook adapter — copilot's A layer (hooks), which until now
 * was a {@link import("../hook-adapter.ts").NoopHookAdapter}.
 *
 * What it wires, and what it deliberately doesn't: `SessionStart` only, which
 * reports WHICH copilot session is live in a worktree. Copilot's remaining hook
 * events (`userPromptSubmitted`, `preToolUse`, `postToolUse`, `agentStop`, …)
 * are available, but Rove does not claim state from them here — copilot is
 * absent from refs/herdr's `full_lifecycle_hook_authority()` set, and herdr
 * itself retreated from the nine lifecycle events it once installed to this one
 * (`COPILOT_REMOVED_LIFECYCLE_HOOK_EVENTS` in `src/integration/mod.rs` is the
 * list it now deletes on sight). So {@link COPILOT_SCREEN_MANIFEST} keeps
 * owning working/blocked/idle, exactly as before; the hook adds session
 * identity on top. Same split cursor landed on.
 *
 * File shape, from GitHub's own hooks reference (docs.github.com/copilot/
 * reference/hooks-reference): user settings are `~/.copilot/settings.json`
 * (`$COPILOT_HOME/settings.json` under the override) and the document is
 *
 *   { "version": 1, "hooks": { "<event>": [ { "type": "command", "command": … } ] } }
 *
 * — FLAT entries, like cursor's and unlike Claude's/Codex's nested groups, so
 * this adapter shares `../flat-hooks.ts` with cursor instead of extending
 * {@link import("../json-hook-adapter.ts").JsonHookAdapter}. The entry may
 * carry the command in `bash`/`powershell` (per-platform) or in `command`
 * (documented as the cross-platform fallback); Rove writes `command`, which is
 * the one form that needs no platform branch and that `isRoveHook` already
 * recognizes.
 */

import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { type FlatHookFormat, mergeFlatHooks, parseFlatHooks } from "../flat-hooks.ts"
import type { EngineHookAdapter, EngineSessionRef } from "../hook-adapter.ts"
import type { EngineActivityDetail } from "../hook-events.ts"
import { editJsonSettings } from "../json-hook-adapter.ts"
import type { HookEditOutcome, HookEventSpec, HookSettingsParse } from "../json-hooks.ts"
import { vendorConfigHome } from "../vendor-home.ts"

/**
 * Copilot hook event → normalized Rove verb.
 *
 * PascalCase `SessionStart`, not the camelCase `sessionStart` the reference
 * lists first: copilot accepts both (PascalCase "for VS Code compatibility"),
 * and the camelCase spelling has a standing report of not firing
 * (github/copilot-cli#1730). refs/herdr installs the PascalCase one and deletes
 * the camelCase one, which is the same conclusion reached from the field.
 */
export const COPILOT_HOOK_EVENT_MAP: readonly HookEventSpec[] = [{ event: "SessionStart", verb: "session-start" }]

/** Copilot keys the entry by `type` (command / http / prompt); Rove's is a command. */
const COPILOT_FORMAT: FlatHookFormat = { vendor: "copilot", eventMap: COPILOT_HOOK_EVENT_MAP, withType: true }

/** Copilot's user-level settings file. `COPILOT_HOME` is copilot's own
 *  override and is already derived once in `../vendor-home.ts`. */
export function copilotSettingsPath(): string {
  return join(vendorConfigHome("copilot"), "settings.json")
}

/** Pure merge over copilot's flat document — see `../flat-hooks.ts`. */
export function mergeCopilotHooks(
  current: Record<string, unknown>,
  install: boolean,
  inv?: readonly string[],
): Record<string, unknown> {
  return mergeFlatHooks(COPILOT_FORMAT, current, install, inv)
}

export class CopilotHookAdapter implements EngineHookAdapter {
  readonly vendor = "copilot" as const

  supportsHooks(): boolean {
    return true
  }

  globalSettingsPath(): string {
    return copilotSettingsPath()
  }

  /** `SessionStart` carries no failure or permission detail — the screen
   *  manifest is what answers "what is it doing" for copilot. */
  activityDetailFromPayload(): EngineActivityDetail | undefined {
    return undefined
  }

  /** Copilot spells the id `session_id`, with a `sessionId` camelCase variant
   *  on some events — refs/herdr's copilot hook reads both, in that order, and
   *  gives up rather than guessing when neither is a non-empty string. */
  sessionFromPayload(payload: Record<string, unknown>): EngineSessionRef | undefined {
    const sessionId = firstString(payload.session_id, payload.sessionId)
    if (!sessionId) return undefined
    const transcriptPath = firstString(payload.transcript_path)
    return { sessionId, ...(transcriptPath ? { transcriptPath } : {}) }
  }

  async installActivityHooks(settingsFilePath: string, opts: { quiet?: boolean } = {}): Promise<HookEditOutcome> {
    // No `~/.copilot` means copilot CLI was never installed here. Creating the
    // directory would leave a config tree for a CLI that will never read it,
    // and reporting a refusal would print on every launch of every machine
    // without copilot. Same call cursor, Kimi and pi make: nothing is missing.
    if (!existsSync(dirname(settingsFilePath))) return { ok: true }
    const outcome = await editJsonSettings(settingsFilePath, (cur) => mergeCopilotHooks(cur, true), parseFlatHooks)
    if (!outcome.ok && !opts.quiet) {
      process.stderr.write(`[rove hooks] copilot: skipped ${outcome.file}: ${outcome.reason}\n`)
    }
    return outcome
  }

  async removeActivityHooks(settingsFilePath: string): Promise<void> {
    if (!existsSync(settingsFilePath)) return
    await editJsonSettings(settingsFilePath, (cur) => mergeCopilotHooks(cur, false), parseFlatHooks)
  }

  /** Doctor's read-only half of the install: the flat validator, not the
   *  Claude/Codex one, which would call copilot's own file broken. */
  hookConfigRefusal(raw: string): string | undefined {
    const parsed: HookSettingsParse = parseFlatHooks(raw)
    return parsed.ok ? undefined : parsed.reason
  }

  supportsWorktreeSync(): boolean {
    return false
  }

  async removeWorktreeSyncHook(): Promise<void> {
    /* Copilot never carried the legacy WorktreeCreate hook. */
  }

  async removeWorktreeWatchHook(): Promise<void> {
    /* ...nor the PostToolUse(Bash) watch hook. */
  }
}

function firstString(...values: readonly unknown[]): string | undefined {
  for (const value of values) if (typeof value === "string" && value) return value
  return undefined
}
