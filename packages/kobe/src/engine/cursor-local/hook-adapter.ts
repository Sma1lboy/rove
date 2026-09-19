/**
 * Cursor Agent hook adapter — the first hook adapter on a CONTRIB engine.
 *
 * Cursor is a data-only catalog entry (`../contrib-engines.ts`): no history
 * reader, no account detector. What it gains here is the A layer of the
 * three-rung ladder (hooks > transcript markers > screen), and only its first
 * rung — `sessionStart`, which reports WHICH cursor session is live in a
 * worktree. Its screen manifest stays exactly as it was and keeps owning
 * working/blocked/idle: cursor's remaining hook events (`beforeSubmitPrompt`,
 * `beforeShellExecution`, `beforeMCPExecution`, `stop`, `sessionEnd`) are
 * DECISION hooks whose answer gates the agent, not observations, so Rove does
 * not install an observer into them. Studied from refs/herdr
 * (`src/integration/targets.rs#install_cursor`), which reaches the same split:
 * cursor is absent from its `full_lifecycle_hook_authority()` set.
 *
 * File shape (verified against cursor-agent 2026.04.17): `~/.cursor/hooks.json`
 * is `{ "version": 1, "hooks": { "<event>": [ { "command": "…" } ] } }` — the
 * entries are FLAT, where Claude and Codex nest a `hooks` array inside each
 * group. That one difference is why this adapter can't extend
 * {@link JsonHookAdapter}; the merge lives in `../flat-hooks.ts`, shared with
 * Copilot CLI (same shape), and everything else (the lock, tmp+rename, and the
 * skip-the-write-when-unchanged rule) is reused from `../json-hook-adapter.ts`.
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

/**
 * Cursor hook event → normalized Rove verb. One entry, deliberately: see the
 * module doc for why the other five cursor events stay unhooked.
 */
export const CURSOR_HOOK_EVENT_MAP: readonly HookEventSpec[] = [{ event: "sessionStart", verb: "session-start" }]

/** Cursor's entries carry no `type` field — the entry is bare `{ command }`. */
const CURSOR_FORMAT: FlatHookFormat = { vendor: "cursor", eventMap: CURSOR_HOOK_EVENT_MAP }

/** Cursor's own override, honored by the CLI itself (verified in the 2026.04.17
 *  bundle). Not in `../vendor-home.ts` because cursor's config dir has no other
 *  reader in Rove — one call site, one derivation. */
export function cursorHooksPath(home: string = homedir()): string {
  const override = process.env.CURSOR_CONFIG_DIR?.trim()
  return join(override || join(home, ".cursor"), "hooks.json")
}

/**
 * Cursor's document validator — the shared flat-shape one, re-exported under
 * cursor's name so the adapter and its tests keep one spelling.
 */
export function parseCursorHooks(raw: string | undefined): HookSettingsParse {
  return parseFlatHooks(raw)
}

/**
 * Pure merge: add or remove Rove's entries in a cursor hooks document,
 * preserving the user's own entries, every other event, and every other key.
 * The mechanics — and the ownership rule that makes a dev-checkout install
 * replaceable by a released one — live in `../flat-hooks.ts`.
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
   * Cursor runs its hooks from its OWN config directory, not the workspace —
   * verified by tracing a real `cursor-agent` run (2026.09.15-d2fe57e): the
   * hook process's cwd was `~/.cursor`, and the payload carries no `cwd` at
   * all, only `workspace_roots`. The first root is the directory the session
   * is actually about, and it is what has to reach the daemon's cwd→task map.
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
    // No `~/.cursor` means cursor-agent was never installed here. Creating the
    // directory would leave a config tree for a CLI that will never read it, and
    // reporting a refusal would print on every launch of every machine without
    // cursor. Same call as the Kimi and pi adapters make: nothing is missing.
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
