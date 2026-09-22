/**
 * Cursor Agent hook adapter, on a data-only CONTRIB engine
 * (`../contrib-engines.ts`).
 *
 * Only `sessionStart` is hooked (which cursor session is live in a
 * worktree); the screen manifest keeps owning working/blocked/idle. Cursor's
 * other events (`beforeSubmitPrompt`, `beforeShellExecution`,
 * `beforeMCPExecution`, `stop`, `sessionEnd`) are DECISION hooks whose answer
 * gates the agent, so Rove installs no observer there.
 *
 * File shape (verified against cursor-agent 2026.04.17): `~/.cursor/hooks.json`
 * is `{ "version": 1, "hooks": { "<event>": [ { "command": "…" } ] } }`, FLAT
 * entries where Claude/Codex nest a `hooks` array, so this can't extend
 * {@link JsonHookAdapter}. The merge is `../flat-hooks.ts` (shared with
 * Copilot CLI); lock, tmp+rename and skip-when-unchanged come from
 * `../json-hook-adapter.ts`.
 */

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { kobeHookInvocation } from "../../cli/invocation.ts"
import { type FlatHookFormat, mergeFlatHooks, parseFlatHooks } from "../flat-hooks.ts"
import type { EngineHookAdapter, EngineSessionRef } from "../hook-adapter.ts"
import type { EngineActivityDetail } from "../hook-events.ts"
import { editJsonSettings } from "../json-hook-adapter.ts"
import type { HookEditOutcome, HookEventSpec, HookSettingsParse } from "../json-hooks.ts"

/** Cursor hook event → Rove verb. One entry on purpose (see module doc). */
export const CURSOR_HOOK_EVENT_MAP: readonly HookEventSpec[] = [{ event: "sessionStart", verb: "session-start" }]

/** Cursor's entries carry no `type` field — the entry is bare `{ command }`. */
const CURSOR_FORMAT: FlatHookFormat = { vendor: "cursor", eventMap: CURSOR_HOOK_EVENT_MAP }

/** `CURSOR_CONFIG_DIR` is honored by the CLI itself (verified in the 2026.04.17
 *  bundle). Not in `../vendor-home.ts`: this is its only reader. */
export function cursorHooksPath(home: string = homedir()): string {
  const override = process.env.CURSOR_CONFIG_DIR?.trim()
  return join(override || join(home, ".cursor"), "hooks.json")
}

/** The shared flat-shape validator under cursor's name. */
export function parseCursorHooks(raw: string | undefined): HookSettingsParse {
  return parseFlatHooks(raw)
}

/**
 * Pure merge: add or remove Rove's entries, preserving everything else.
 * Mechanics and the ownership rule live in `../flat-hooks.ts`.
 */
export function mergeCursorHooks(
  current: Record<string, unknown>,
  install: boolean,
  inv: readonly string[] = kobeHookInvocation(),
): Record<string, unknown> {
  return mergeFlatHooks(CURSOR_FORMAT, current, install, inv)
}

export class CursorHookAdapter implements EngineHookAdapter {
  readonly vendor = "cursor" as const

  supportsHooks(): boolean {
    return true
  }

  globalSettingsPath(): string {
    return cursorHooksPath()
  }

  /** `sessionStart` carries no failure or permission detail — the screen
   *  manifest is what answers "what is it doing" for cursor. */
  activityDetailFromPayload(): EngineActivityDetail | undefined {
    return undefined
  }

  /**
   * Cursor runs hooks with cwd `~/.cursor` and sends no `cwd`, only
   * `workspace_roots` (traced on cursor-agent 2026.09.15-d2fe57e); the first
   * root is the session's directory for the daemon's cwd→task map.
   */
  cwdFromPayload(payload: Record<string, unknown>): string | undefined {
    const roots = payload.workspace_roots
    return Array.isArray(roots) ? firstString(...roots) : undefined
  }

  /** Cursor's payload spells the id `session_id`, falling back to
   *  `conversation_id` on the events that predate it, and pipes
   *  `transcript_path` alongside (cursor-agent 2026.04.17). */
  sessionFromPayload(payload: Record<string, unknown>): EngineSessionRef | undefined {
    const sessionId = firstString(payload.session_id, payload.conversation_id)
    if (!sessionId) return undefined
    const transcriptPath = firstString(payload.transcript_path)
    return { sessionId, ...(transcriptPath ? { transcriptPath } : {}) }
  }

  async installActivityHooks(settingsFilePath: string, opts: { quiet?: boolean } = {}): Promise<HookEditOutcome> {
    // No `~/.cursor` = cursor-agent not installed: don't create a config tree
    // nobody reads, and don't print a refusal on every launch.
    if (!existsSync(dirname(settingsFilePath))) return { ok: true }
    const outcome = await editJsonSettings(settingsFilePath, (cur) => mergeCursorHooks(cur, true), parseCursorHooks)
    if (!outcome.ok && !opts.quiet) {
      process.stderr.write(`[rove hooks] cursor: skipped ${outcome.file}: ${outcome.reason}\n`)
    }
    return outcome
  }

  async removeActivityHooks(settingsFilePath: string): Promise<void> {
    if (!existsSync(settingsFilePath)) return
    await editJsonSettings(settingsFilePath, (cur) => mergeCursorHooks(cur, false), parseCursorHooks)
  }

  hookConfigRefusal(raw: string): string | undefined {
    const parsed = parseCursorHooks(raw)
    return parsed.ok ? undefined : parsed.reason
  }

  supportsWorktreeSync(): boolean {
    return false
  }

  async removeWorktreeSyncHook(): Promise<void> {
    /* Cursor never carried the legacy WorktreeCreate hook. */
  }

  async removeWorktreeWatchHook(): Promise<void> {
    /* ...nor the PostToolUse(Bash) watch hook. */
  }
}

function firstString(...values: readonly unknown[]): string | undefined {
  for (const value of values) if (typeof value === "string" && value) return value
  return undefined
}
