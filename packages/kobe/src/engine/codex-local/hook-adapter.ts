/**
 * Codex hook adapter (KOB) — the second real {@link EngineHookAdapter}.
 *
 * Codex's hook system (https://developers.openai.com/codex/hooks) uses the SAME
 * settings-file shape as Claude Code — `{ "hooks": { "<Event>": [ { matcher?,
 * hooks: [{ type: "command", command }] } ] } }` — read from
 * `~/.codex/hooks.json`. So this adapter inherits ALL the install/merge/IO
 * mechanics from {@link JsonHookAdapter} and supplies only three things: its
 * vendor id, its event→verb table, and its settings path.
 *
 * What's wired vs. what isn't (Codex's event vocabulary is narrower than
 * Claude's, so three neutral verbs have no clean Codex signal in v1):
 *   - `SessionStart`     → session-start
 *   - `UserPromptSubmit` → turn-start
 *   - `Stop`             → turn-complete
 *   - `PostToolUse`(Bash)→ worktree-created (inherited worktree-watch observer)
 * NOT wired: `turn-failed` (Codex's hook enum has no failure event at all —
 * see `activityDetailFromPayload`), `session-end`
 * (no SessionEnd), `awaiting-input` (Codex's only "waiting" event is
 * `PermissionRequest`, an allow/deny DECISION hook — installing kobe's observer
 * on it could interfere with Codex's approval flow, the same provider-hook trap
 * that broke `claude --worktree`, so we leave it alone). The polling fallback
 * still covers those states.
 *
 * Trust model: Codex won't RUN a non-managed command hook until the user trusts
 * it once via `/hooks` (or launches with `--dangerously-bypass-hook-trust`).
 * kobe writes the definition but never auto-bypasses trust, so codex activity
 * badges light up only after the user approves the hook — by design.
 */

import { homedir } from "node:os"
import { join } from "node:path"
import type { EngineSessionRef } from "../hook-adapter.ts"
import type { EngineActivityDetail, EngineActivityKind } from "../hook-events.ts"
import { JsonHookAdapter } from "../json-hook-adapter.ts"
import type { HookEventSpec } from "../json-hooks.ts"

/** Codex hook event → normalized kobe verb. The ONE place Codex event names
 *  live. Only the verbs Codex can deliver without touching a decision hook. */
const EVENT_MAP: readonly HookEventSpec[] = [
  { event: "SessionStart", verb: "session-start" },
  { event: "UserPromptSubmit", verb: "turn-start" },
  { event: "Stop", verb: "turn-complete" },
  // Lifecycle-only verbs (docs/design/plugin-events.md). Codex ships both
  // compact hooks natively; SessionEnd/Subagent* are documented upstream but
  // absent from the pinned protocol — left out until verified.
  { event: "PreCompact", verb: "pre-compact" },
  { event: "PostCompact", verb: "post-compact" },
  // Tool family: gated (see JsonHookAdapter.gatedVerbs) + behind Codex's own
  // hook trust prompt. Failures arrive folded into tool_response, so there is
  // no tool-failed row.
  { event: "PreToolUse", verb: "tool-pre" },
  { event: "PostToolUse", verb: "tool-post" },
]

/** The Codex events kobe owns — a merge replaces only these. */
export const KOBE_CODEX_HOOK_EVENTS: readonly string[] = EVENT_MAP.map((e) => e.event)

/** Where Codex reads user hook definitions. */
export function codexHooksPath(): string {
  return join(homedir(), ".codex", "hooks.json")
}

export class CodexHookAdapter extends JsonHookAdapter {
  readonly vendor = "codex" as const
  protected readonly eventMap = EVENT_MAP

  globalSettingsPath(): string {
    return codexHooksPath()
  }

  /** Codex spells the tool fields `tool_name`/`tool_response`; compaction
   *  carries the same `trigger` values as Claude.
   *
   *  No `turn-failed` branch, and that is not an oversight: Codex's hook
   *  event enum (verified against codex-cli 0.149.1's binary) is PreToolUse /
   *  PermissionRequest / PostToolUse / PreCompact / PostCompact / SessionStart
   *  / SessionEnd / UserPromptSubmit / SubagentStart / SubagentStop / Stop —
   *  there is no failure event to classify. `TurnFailed` exists in the binary
   *  but is an app-server THREAD event (`turn.failed`), not a hook, so it
   *  never reaches a `kobe hook` invocation. Codex therefore cannot reach
   *  `rate_limited` through hooks at all; its quota probe
   *  (`vendorsWithQuotaProbe`) is the only path, and adding a classifier here
   *  would be dead code pretending otherwise. */
  override activityDetailFromPayload(
    kind: EngineActivityKind,
    payload: Record<string, unknown>,
  ): EngineActivityDetail | undefined {
    if (kind === "tool-pre" || kind === "tool-post") {
      return { tool: { ...(typeof payload.tool_name === "string" ? { name: payload.tool_name } : {}) } }
    }
    if (kind === "pre-compact" || kind === "post-compact") {
      return { compact: { trigger: payload.trigger === "manual" ? "manual" : "auto" } }
    }
    return undefined
  }

  /** Codex spells session identity exactly as Claude does. Its `Stop` payload
   *  schema (read off codex-cli 0.153.2's binary) REQUIRES both `session_id`
   *  and `transcript_path`, and `transcript_path` is the rollout JSONL — the
   *  same file `codexHistoryReader.transcriptPath` resolves. Without this
   *  override the daemon records a codex turn with no transcript to read, so
   *  {@link import("./turns.ts").readCodexTurns} is never reached and
   *  `rove api agent-turns` answers an empty page for a codex task.
   *  `transcript_path` is nullable in the schema, hence the string guard. */
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
