/**
 * MastraCode hook adapter.
 *
 * MastraCode reads `~/.mastracode/hooks.json`, whose entries are FLAT — the
 * entry IS the command, `{ "type": "command", "command": "…" }`, with no inner
 * `hooks` array — the same shape cursor and Copilot CLI use, so the merge is
 * `../flat-hooks.ts` with `withType` on. Everything else (the lock, tmp+rename,
 * skip-the-write-when-unchanged) is reused from `../json-hook-adapter.ts`.
 *
 * Unlike cursor's and grok's single `SessionStart`, MastraCode publishes a
 * FULL lifecycle: its events cover the start of a turn, the permission wait,
 * the resume, the interrupt and the end. That is why `../contrib-engines.ts`
 * carries no screen rules for it — the hook is the only state signal Rove has,
 * and it is a complete one.
 */

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { kobeHookInvocation } from "../../cli/invocation.ts"
import { type FlatHookFormat, mergeFlatHooks, parseFlatHooks } from "../flat-hooks.ts"
import type { EngineHookAdapter, EngineSessionRef } from "../hook-adapter.ts"
import type { EngineActivityDetail, EngineActivityKind } from "../hook-events.ts"
import { editJsonSettings } from "../json-hook-adapter.ts"
import type { HookEditOutcome, HookEventSpec, HookSettingsParse } from "../json-hooks.ts"

/**
 * MastraCode hook event → normalized Rove verb.
 *
 * DROPPED on purpose, though the CLI publishes them:
 *  - `PreToolUse`. It fires once per tool call and would only ever re-assert
 *    "working", which `AgentStart` already said — a subprocess spawn per tool
 *    call is a pure latency tax on the engine.
 *  - `SubagentStart` / `SubagentEnd`. Same reasoning per nested agent; the
 *    parent turn is already running, so neither moves the badge.
 */
export const MASTRACODE_HOOK_EVENT_MAP: readonly HookEventSpec[] = [
  { event: "SessionStart", verb: "session-start" },
  { event: "UserPromptSubmit", verb: "turn-start" },
  { event: "AgentStart", verb: "turn-start" },
  { event: "PermissionRequest", verb: "awaiting-input" },
  // Approved or denied, the engine resumes the same turn.
  { event: "PermissionResult", verb: "turn-start" },
  { event: "Interrupt", verb: "turn-interrupted" },
  { event: "AgentEnd", verb: "turn-complete" },
  { event: "Stop", verb: "turn-complete" },
]

/** MastraCode's entries carry a `type` discriminator, like Copilot's. */
const MASTRACODE_FORMAT: FlatHookFormat = {
  vendor: "mastracode",
  eventMap: MASTRACODE_HOOK_EVENT_MAP,
  withType: true,
}

/** MastraCode's config directory is `~/.mastracode`, with no env override. */
export function mastracodeHooksPath(home: string = homedir()): string {
  return join(home, ".mastracode", "hooks.json")
}

/**
 * Pure merge: add or remove Rove's entries in a MastraCode hooks document,
 * preserving the user's own entries, every other event, and every other key.
 */
export function mergeMastracodeHooks(
  current: Record<string, unknown>,
  install: boolean,
  inv: readonly string[] = kobeHookInvocation(),
): Record<string, unknown> {
  return mergeFlatHooks(MASTRACODE_FORMAT, current, install, inv)
}

export class MastracodeHookAdapter implements EngineHookAdapter {
  readonly vendor = "mastracode" as const

  supportsHooks(): boolean {
    return true
  }

  globalSettingsPath(): string {
    return mastracodeHooksPath()
  }

  /** The permission event is the only one carrying state beyond its verb, and
   *  what it says is already in the verb: MastraCode blocks on a decision. */
  activityDetailFromPayload(kind: EngineActivityKind): EngineActivityDetail | undefined {
    return kind === "awaiting-input" ? { waiting: "permission" } : undefined
  }

  sessionFromPayload(payload: Record<string, unknown>): EngineSessionRef | undefined {
    if (typeof payload.session_id !== "string" || !payload.session_id) return undefined
    return {
      sessionId: payload.session_id,
      ...(typeof payload.transcript_path === "string" && payload.transcript_path
        ? { transcriptPath: payload.transcript_path }
        : {}),
    }
  }

  async installActivityHooks(settingsFilePath: string, opts: { quiet?: boolean } = {}): Promise<HookEditOutcome> {
    // No `~/.mastracode` means the CLI was never installed here; creating the
    // directory would leave a config tree nothing will ever read.
    if (!existsSync(dirname(settingsFilePath))) return { ok: true }
    const outcome = await editJsonSettings(
      settingsFilePath,
      (cur) => mergeMastracodeHooks(cur, true),
      parseMastracodeHooks,
    )
    if (!outcome.ok && !opts.quiet) {
      process.stderr.write(`[rove hooks] mastracode: skipped ${outcome.file}: ${outcome.reason}\n`)
    }
    return outcome
  }

  async removeActivityHooks(settingsFilePath: string): Promise<void> {
    if (!existsSync(settingsFilePath)) return
    await editJsonSettings(settingsFilePath, (cur) => mergeMastracodeHooks(cur, false), parseMastracodeHooks)
  }

  hookConfigRefusal(raw: string): string | undefined {
    const parsed = parseMastracodeHooks(raw)
    return parsed.ok ? undefined : parsed.reason
  }

  supportsWorktreeSync(): boolean {
    return false
  }

  async removeWorktreeSyncHook(): Promise<void> {
    /* MastraCode never carried the legacy WorktreeCreate hook. */
  }

  async removeWorktreeWatchHook(): Promise<void> {
    /* ...nor the PostToolUse(Bash) watch hook. */
  }
}

/** MastraCode's document validator — the shared flat-shape one under this
 *  engine's name, so the adapter and its tests keep one spelling. */
export function parseMastracodeHooks(raw: string | undefined): HookSettingsParse {
  return parseFlatHooks(raw)
}
