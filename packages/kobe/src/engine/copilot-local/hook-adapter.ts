/**
 * GitHub Copilot CLI hook adapter. Wires `SessionStart` only, for session
 * identity: the other events aren't a verified authority for turn state, so
 * {@link COPILOT_SCREEN_MANIFEST} keeps owning working/blocked/idle.
 *
 * Settings are `~/.copilot/settings.json` (`$COPILOT_HOME/settings.json`),
 * per docs.github.com/copilot/reference/hooks-reference:
 *
 *   { "version": 1, "hooks": { "<event>": [ { "type": "command", "command": … } ] } }
 *
 * Flat entries like cursor's, so this shares `../flat-hooks.ts` rather than
 * {@link import("../json-hook-adapter.ts").JsonHookAdapter}. Rove writes
 * `command` (the cross-platform fallback to `bash`/`powershell`): no platform
 * branch, and `isRoveHook` already recognizes it.
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
 * Copilot hook event → normalized Rove verb. PascalCase: copilot accepts both
 * spellings, and camelCase `sessionStart` is reported not to fire
 * (github/copilot-cli#1730).
 */
export const COPILOT_HOOK_EVENT_MAP: readonly HookEventSpec[] = [{ event: "SessionStart", verb: "session-start" }]

/** Copilot keys the entry by `type` (command / http / prompt); Rove's is a command. */
const COPILOT_FORMAT: FlatHookFormat = { vendor: "copilot", eventMap: COPILOT_HOOK_EVENT_MAP, withType: true }

/** Copilot's user-level settings file (honors `COPILOT_HOME`). */
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

  /** `session_id`, else the `sessionId` variant some events use; neither → no guess. */
  sessionFromPayload(payload: Record<string, unknown>): EngineSessionRef | undefined {
    const sessionId = firstString(payload.session_id, payload.sessionId)
    if (!sessionId) return undefined
    const transcriptPath = firstString(payload.transcript_path)
    return { sessionId, ...(transcriptPath ? { transcriptPath } : {}) }
  }

  async installActivityHooks(settingsFilePath: string, opts: { quiet?: boolean } = {}): Promise<HookEditOutcome> {
    // No `~/.copilot` = no copilot: don't create it, and don't report a
    // refusal (it would print on every launch of every machine without copilot).
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
