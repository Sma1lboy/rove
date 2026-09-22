/**
 * Codex {@link EngineHookAdapter}. Codex hooks
 * (https://developers.openai.com/codex/hooks) use Claude Code's settings shape
 * (`{ "hooks": { "<Event>": [ { matcher?, hooks: [{ type: "command", command }] } ] } }`)
 * in `~/.codex/hooks.json`, so {@link JsonHookAdapter} does the IO and this
 * supplies the vendor id, event table, and path.
 *
 * NOT wired: `turn-failed` (Codex has no failure hook event) and
 * `awaiting-input` (its only "waiting" event, `PermissionRequest`, is an
 * allow/deny decision hook; an observer there could interfere with approval,
 * the same trap that broke `claude --worktree`). Polling covers both states.
 *
 * Codex won't run a non-managed hook until the user trusts it via `/hooks`
 * (or `--dangerously-bypass-hook-trust`). kobe never bypasses trust, so codex
 * activity badges light only after the user approves.
 */

import { join } from "node:path"
import type { EngineSessionRef } from "../hook-adapter.ts"
import type { EngineActivityDetail, EngineActivityKind } from "../hook-events.ts"
import { JsonHookAdapter } from "../json-hook-adapter.ts"
import type { HookEventSpec } from "../json-hooks.ts"
import { vendorConfigHome } from "../vendor-home.ts"

/** Codex hook event → kobe verb; the one place Codex event names live. No decision hooks. */
const EVENT_MAP: readonly HookEventSpec[] = [
  { event: "SessionStart", verb: "session-start" },
  { event: "UserPromptSubmit", verb: "turn-start" },
  { event: "Stop", verb: "turn-complete" },
  // Without it `/quit` leaves the row lit until the pty-exit record lands.
  { event: "SessionEnd", verb: "session-end" },
  // Lifecycle-only verbs (docs/design/plugin-events.md), verified in codex-cli
  // 0.153.4's enum. Subagent* drives the `◇N` sidebar marker.
  { event: "PreCompact", verb: "pre-compact" },
  { event: "PostCompact", verb: "post-compact" },
  { event: "SubagentStart", verb: "subagent-start" },
  { event: "SubagentStop", verb: "subagent-stop" },
  // Gated (JsonHookAdapter.gatedVerbs) and behind Codex's trust prompt.
  // Failures fold into tool_response, so no tool-failed row.
  { event: "PreToolUse", verb: "tool-pre" },
  { event: "PostToolUse", verb: "tool-post" },
]

/** The Codex events kobe owns — a merge replaces only these. */
export const KOBE_CODEX_HOOK_EVENTS: readonly string[] = EVENT_MAP.map((e) => e.event)

/** Where Codex reads user hook definitions. */
export function codexHooksPath(): string {
  return join(vendorConfigHome("codex"), "hooks.json")
}

export class CodexHookAdapter extends JsonHookAdapter {
  readonly vendor = "codex" as const
  protected readonly eventMap = EVENT_MAP

  globalSettingsPath(): string {
    return codexHooksPath()
  }

  /** Codex spells tool fields `tool_name`/`tool_response`; compaction `trigger`
   *  matches Claude.
   *
   *  No `turn-failed` branch: codex-cli 0.153.4's hook enum is PreToolUse /
   *  PermissionRequest / PostToolUse / PreCompact / PostCompact / SessionStart /
   *  SessionEnd / UserPromptSubmit / SubagentStart / SubagentStop / Stop. The
   *  failure signal is the app-server thread event `turn.failed`, never a hook,
   *  so codex reaches `rate_limited` only via its quota probe
   *  (`vendorsWithQuotaProbe`).
   *
   *  No `subagent-*` branch: the event names are verified, the payload fields
   *  are not (`agent_type`/`agent_id` exist in the binary, unproven for these
   *  payloads). Detail feeds the plugin stream, not the `◇N` marker (which
   *  counts `engine.lifecycle` events), so a guessed field name buys nothing. */
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

  /** Same fields as Claude. codex-cli 0.153.2's `Stop` schema requires
   *  `session_id` and `transcript_path` (nullable), the rollout JSONL that
   *  `codexHistoryReader.transcriptPath` resolves. Without this,
   *  {@link import("./turns.ts").readCodexTurns} is never reached and
   *  `rove api agent-turns` returns an empty page for codex. */
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
