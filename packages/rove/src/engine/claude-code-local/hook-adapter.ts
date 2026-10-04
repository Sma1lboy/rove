/**
 * Claude Code {@link EngineHookAdapter}: writes `kobe hook <verb>` hooks into
 * the GLOBAL `~/.claude/settings.json`; the daemon maps each hook's cwd to a task
 * (`daemon/cwd-task.ts`). I/O and install/remove live in {@link JsonHookAdapter};
 * this file owns Claude's event names, detail decoding, and the legacy
 * `WorktreeCreate` cleanup.
 *
 * Global, not per-worktree: per-task hooks missed already-running engines and
 * leaked into the real repo root. The cost is cheap — `kobe hook` no-ops fast
 * (never spawning the daemon) outside a task.
 *
 * The file is SHARED: merges tag Rove's entries by command substring and
 * replace only those, preserving the user's hooks.
 */

import { join } from "node:path"
import type { EngineSessionRef } from "../hook-adapter.ts"
import type { EngineActivityDetail, EngineActivityKind } from "../hook-events.ts"
import { JsonHookAdapter, editJsonSettings } from "../json-hook-adapter.ts"
import {
  type HookEventSpec,
  buildActivityHooks,
  isObject,
  mergeActivityHooks as mergeActivityHooksCore,
  removeRoveHooks,
  removeWorktreeWatchHook,
} from "../json-hooks.ts"
import { vendorConfigHome } from "../vendor-home.ts"

export { removeWorktreeWatchHook }

/** Claude Code hook event → normalized kobe verb. The ONE place Claude event
 *  names live. `matcher` narrows which Notification types fire. */
export const CLAUDE_HOOK_EVENT_MAP: readonly HookEventSpec[] = [
  { event: "SessionStart", verb: "session-start" },
  { event: "UserPromptSubmit", verb: "turn-start" },
  { event: "Stop", verb: "turn-complete" },
  { event: "StopFailure", verb: "turn-failed" },
  { event: "Notification", matcher: "permission_prompt", verb: "awaiting-input" },
  // elicitation_dialog = a QUESTION dialog (AskUserQuestion / MCP elicitation),
  // which F7 must reach. NOT idle_prompt: it fires for any idle session.
  { event: "Notification", matcher: "elicitation_dialog", verb: "awaiting-input" },
  { event: "SessionEnd", verb: "session-end" },
  // Lifecycle-only verbs (docs/design/plugin-events.md) — forwarded to plugin
  // event hooks, never folded into the activity badge.
  { event: "PreCompact", verb: "pre-compact" },
  { event: "PostCompact", verb: "post-compact" },
  { event: "SubagentStart", verb: "subagent-start" },
  { event: "SubagentStop", verb: "subagent-stop" },
  // Gated (JsonHookAdapter.gatedVerbs): fire on every tool call machine-wide,
  // so installed only while a plugin declares a tool.* hook.
  { event: "PreToolUse", verb: "tool-pre" },
  { event: "PostToolUse", verb: "tool-post" },
  { event: "PostToolUseFailure", verb: "tool-failed" },
]

/** The events kobe owns — a merge replaces only these. Deduped:
 *  one event can carry several matcher-scoped specs. */
export const KOBE_HOOK_EVENTS: readonly string[] = [...new Set(CLAUDE_HOOK_EVENT_MAP.map((e) => e.event))]

/** Query side of {@link CLAUDE_HOOK_EVENT_MAP}; undefined for uninstalled events. */
export function claudeVerbForHookEvent(event: string): EngineActivityKind | undefined {
  return CLAUDE_HOOK_EVENT_MAP.find((e) => e.event === event)?.verb
}

/** Claude StopFailure `error_type` → neutral failure class. */
function failureFromErrorType(errorType: unknown): EngineActivityDetail["failure"] {
  if (typeof errorType !== "string") return "other"
  if (errorType === "rate_limit" || errorType === "overloaded") return "rate_limit"
  if (errorType === "billing_error") return "billing"
  return "other"
}

/** Settings in the active Claude profile, independent of Rove state home. */
export function claudeSettingsPath(): string {
  return join(vendorConfigHome("claude"), "settings.json")
}

/** Retired Rove verb in Claude WorktreeCreate hook records. */
const WORKTREE_SYNC_VERB = "worktree-created"

/** Shared core bound to {@link CLAUDE_HOOK_EVENT_MAP}. Exported for tests. */
export function buildClaudeHooks(inv?: readonly string[]): Record<string, unknown> {
  return inv ? buildActivityHooks(CLAUDE_HOOK_EVENT_MAP, inv) : buildActivityHooks(CLAUDE_HOOK_EVENT_MAP)
}

/** Shared core bound to {@link CLAUDE_HOOK_EVENT_MAP}. Exported for tests. */
export function mergeActivityHooks(
  current: Record<string, unknown>,
  install: boolean,
  inv?: readonly string[],
): Record<string, unknown> {
  return inv
    ? mergeActivityHooksCore(current, install, CLAUDE_HOOK_EVENT_MAP, inv)
    : mergeActivityHooksCore(current, install, CLAUDE_HOOK_EVENT_MAP)
}

/**
 * Pure merge: add (or with `command === null`, remove) kobe's WorktreeCreate
 * hook in a settings object, preserving the user's own hooks + other keys.
 * Drops kobe's prior entry first so re-install is idempotent + removal clean.
 */
export function mergeWorktreeSyncHook(
  current: Record<string, unknown>,
  command: string | null,
): Record<string, unknown> {
  const { hooks: rawHooks, ...restSettings } = current
  const { WorktreeCreate, ...otherHooks } = isObject(rawHooks) ? rawHooks : {}
  const prior = Array.isArray(WorktreeCreate) ? WorktreeCreate : []
  const kept = removeRoveHooks(prior, [WORKTREE_SYNC_VERB])
  if (command !== null) kept.push({ hooks: [{ type: "command", command }] })
  const nextHooks: Record<string, unknown> = { ...otherHooks }
  if (kept.length > 0) nextHooks.WorktreeCreate = kept
  return Object.keys(nextHooks).length > 0 ? { ...restSettings, hooks: nextHooks } : { ...restSettings }
}

export class ClaudeHookAdapter extends JsonHookAdapter {
  readonly vendor = "claude" as const
  protected readonly eventMap = CLAUDE_HOOK_EVENT_MAP

  globalSettingsPath(): string {
    return claudeSettingsPath()
  }

  /** Fire-time translation of Claude's stdin payload into neutral detail. */
  override activityDetailFromPayload(
    kind: EngineActivityKind,
    payload: Record<string, unknown>,
  ): EngineActivityDetail | undefined {
    if (kind === "turn-failed") return { failure: failureFromErrorType(payload.error_type) }
    if (kind === "awaiting-input") {
      return { waiting: payload.notification_type === "elicitation_dialog" ? "input" : "permission" }
    }
    if (kind === "tool-pre" || kind === "tool-post" || kind === "tool-failed") {
      return {
        tool: {
          ...(typeof payload.tool_name === "string" ? { name: payload.tool_name } : {}),
          ...(typeof payload.tool_use_id === "string" ? { id: payload.tool_use_id } : {}),
        },
      }
    }
    if (kind === "pre-compact" || kind === "post-compact") {
      return { compact: { trigger: payload.trigger === "manual" ? "manual" : "auto" } }
    }
    if (kind === "subagent-start" || kind === "subagent-stop") {
      return {
        subagent: {
          ...(typeof payload.agent_type === "string" ? { type: payload.agent_type } : {}),
          ...(typeof payload.agent_id === "string" ? { id: payload.agent_id } : {}),
        },
      }
    }
    return undefined
  }

  /** Every payload carries `session_id` (+ `transcript_path`), including
   *  user-typed sessions kobe never spawned. */
  override sessionFromPayload(payload: Record<string, unknown>): EngineSessionRef | undefined {
    if (typeof payload.session_id !== "string" || !payload.session_id) return undefined
    return {
      sessionId: payload.session_id,
      ...(typeof payload.transcript_path === "string" && payload.transcript_path
        ? { transcriptPath: payload.transcript_path }
        : {}),
    }
  }

  /**
   * Claude stamps subprocesses (hooks included) with `CLAUDE_CODE_SESSION_ATTENDED`:
   * `"1"` attended, `"0"` headless (`claude -p`, SDK). Only an explicit `"0"`
   * counts — an older Claude that sets nothing must keep reporting.
   * `CLAUDE_CODE_CHILD_SESSION` is NOT the discriminator: it's on every subprocess.
   */
  isUnattendedSession(env: NodeJS.ProcessEnv): boolean {
    return env.CLAUDE_CODE_SESSION_ATTENDED === "0"
  }

  /** Only Claude ever had the legacy `WorktreeCreate` hook to clean up. */
  override supportsWorktreeSync(): boolean {
    return true
  }

  override async removeWorktreeSyncHook(settingsFilePath: string): Promise<void> {
    await editJsonSettings(settingsFilePath, (cur) => mergeWorktreeSyncHook(cur, null))
  }
}
