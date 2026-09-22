/**
 * Kimi Code hook adapter (docs/design/plugin-events.md "Kimi adapter").
 *
 * Kimi's hooks are TOML `[[hooks]]` tables in `~/.kimi-code/config.toml`
 * (keys: event, matcher?, command, timeout; JSON payload on stdin with
 * `session_id` + `cwd`; verified against the 0.37.2 binary), so this can't
 * extend {@link JsonHookAdapter}. It remove-then-appends a block between
 * `# >>> rove hooks` / `# <<< rove hooks`: config outside the block is never
 * parsed or rewritten, and identical content skips the write.
 *
 * Event map notes (vs Claude's):
 *   - `Interrupt` → turn-interrupted: Kimi does NOT fire Stop after a user
 *     interrupt, so without this the turn strands in `running`.
 *   - `PermissionRequest` → awaiting-input: unlike Codex (a synchronous
 *     allow/deny hook we avoid), Kimi runs it as a plain command hook, so an
 *     exit-0 observer is safe.
 *   - `Notification` is NOT wired: its types are undocumented, and unfiltered
 *     it would mark every idle prompt as needs-input.
 */

import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { kobeHookInvocation } from "../../cli/invocation.ts"
import { quoteShellArgv } from "../../lib/shell-command.ts"
import type { EngineHookAdapter, EngineSessionRef } from "../hook-adapter.ts"
import type { EngineActivityDetail, EngineActivityKind } from "../hook-events.ts"
import {
  GATED_TOOL_VERBS,
  type HookEditOutcome,
  type HookEventSpec,
  hookCommandQuoting,
  roveHookArgs,
} from "../json-hooks.ts"
import { vendorConfigHome } from "../vendor-home.ts"

/** Kimi hook event → normalized kobe verb. The ONE place Kimi event names live. */
export const KIMI_HOOK_EVENT_MAP: readonly HookEventSpec[] = [
  { event: "SessionStart", verb: "session-start" },
  { event: "UserPromptSubmit", verb: "turn-start" },
  { event: "Stop", verb: "turn-complete" },
  { event: "StopFailure", verb: "turn-failed" },
  { event: "Interrupt", verb: "turn-interrupted" },
  { event: "PermissionRequest", verb: "awaiting-input" },
  { event: "SessionEnd", verb: "session-end" },
  // Lifecycle-only verbs (docs/design/plugin-events.md) — forwarded to
  // plugin event hooks, never folded into the activity badge.
  { event: "PreCompact", verb: "pre-compact" },
  { event: "PostCompact", verb: "post-compact" },
  { event: "SubagentStart", verb: "subagent-start" },
  { event: "SubagentStop", verb: "subagent-stop" },
  // Tool family: gated — installed only while an enabled plugin declares a
  // tool.* hook (same volume gate as the JSON adapters).
  { event: "PreToolUse", verb: "tool-pre" },
  { event: "PostToolUse", verb: "tool-post" },
  { event: "PostToolUseFailure", verb: "tool-failed" },
]

/** The Kimi events kobe owns — exported for tests (event-ownership parity
 *  with `KOBE_CODEX_HOOK_EVENTS`). */
export const KOBE_KIMI_HOOK_EVENTS: readonly string[] = [...new Set(KIMI_HOOK_EVENT_MAP.map((e) => e.event))]

const BLOCK_BEGIN = "# >>> rove hooks"
const BLOCK_END = "# <<< rove hooks"
/** Bound each hook spawn — `kobe hook` is sub-second; Kimi's default is 30s. */
const HOOK_TIMEOUT_SECONDS = 10

/** Where Kimi reads its config (the hooks live inline in config.toml). */
export function kimiConfigPath(home: string = homedir()): string {
  return join(vendorConfigHome("kimi", { env: (k) => process.env[k], home: () => home }), "config.toml")
}

/** Render kobe's `[[hooks]]` block. `inv` is injectable for tests. */
export function renderKimiHookBlock(
  inv: readonly string[] = kobeHookInvocation(),
  opts: { toolEvents?: boolean } = {},
): string {
  const lines: string[] = [BLOCK_BEGIN]
  for (const spec of KIMI_HOOK_EVENT_MAP) {
    if (!opts.toolEvents && GATED_TOOL_VERBS.has(spec.verb)) continue
    // JSON.stringify doubles as a TOML basic-string quoter (same trick as
    // codex-local/trust.ts).
    const command = quoteShellArgv([...inv, "hook", spec.verb, ...roveHookArgs("kimi")], hookCommandQuoting())
    lines.push("[[hooks]]")
    lines.push(`event = ${JSON.stringify(spec.event)}`)
    if (spec.matcher) lines.push(`matcher = ${JSON.stringify(spec.matcher)}`)
    lines.push(`command = ${JSON.stringify(command)}`)
    lines.push(`timeout = ${HOOK_TIMEOUT_SECONDS}`)
    lines.push("")
  }
  lines.push(BLOCK_END)
  return lines.join("\n")
}

/** Drop kobe's marker block (inclusive) from a config, preserving everything
 *  else byte-for-byte. No block → the input unchanged. */
export function removeKimiHookBlock(content: string): string {
  const lines = content.split("\n")
  const out: string[] = []
  let inBlock = false
  for (const line of lines) {
    if (line.trim() === BLOCK_BEGIN) {
      inBlock = true
      // Also swallow the blank separator line the install appended before us.
      if (out.length > 0 && out[out.length - 1] === "") out.pop()
      continue
    }
    if (inBlock) {
      if (line.trim() === BLOCK_END) inBlock = false
      continue
    }
    out.push(line)
  }
  return out.join("\n")
}

/** Pure merge: config text → config text with kobe's block replaced (install)
 *  or removed. The install appends at EOF — a `[[hooks]]` table there attaches
 *  to nothing above it, so the user's config is never re-parsed. */
export function mergeKimiHooks(
  content: string,
  install: boolean,
  inv: readonly string[] = kobeHookInvocation(),
  opts: { toolEvents?: boolean } = {},
): string {
  const base = removeKimiHookBlock(content)
  if (!install) return base
  const trimmed = base.replace(/\n+$/, "")
  const lead = trimmed.length > 0 ? `${trimmed}\n\n` : ""
  return `${lead}${renderKimiHookBlock(inv, opts)}\n`
}

/**
 * Kimi StopFailure payload → neutral failure class. Two fields, because
 * Kimi's two call sites disagree (verified against 0.37.2):
 *
 *   - `error_type` is the JS error CLASS: `APIProviderRateLimitError` /
 *     `APIProviderQuotaExhaustedError` for a limit, `APIStatusError` for
 *     anything else with a status (a 429 included — class alone isn't enough).
 *   - `error_message` carries a `[provider.*]` code: `provider.rate_limit`,
 *     or `provider.auth_error` for the 403 "You've reached your 5-hour usage
 *     limit" — filed under AUTH but a quota wall.
 *
 * That case is `billing`: it needs a human, and the daemon arms no resume
 * timer for `billing`. A plain 429 is `rate_limit` and does arm one.
 */
function kimiFailureDetail(payload: Record<string, unknown>): EngineActivityDetail {
  const type = typeof payload.error_type === "string" ? payload.error_type : ""
  const message = typeof payload.error_message === "string" ? payload.error_message : ""
  const note = type || undefined
  const failure = ((): EngineActivityDetail["failure"] => {
    if (type === "APIProviderRateLimitError" || message.includes("provider.rate_limit")) return "rate_limit"
    // Quota exhaustion rides a 429 too, but Kimi codes it `provider.api_error`
    // — the CLASS name is the only thing that distinguishes it.
    if (type === "APIProviderQuotaExhaustedError") return "rate_limit"
    if (message.includes("provider.auth_error")) return "billing"
    return "other"
  })()
  return { failure, ...(note ? { note } : {}) }
}

export class KimiHookAdapter implements EngineHookAdapter {
  readonly vendor = "kimi" as const

  supportsHooks(): boolean {
    return true
  }

  globalSettingsPath(): string {
    return kimiConfigPath()
  }

  /** Tool fields are spelled `tool_name`; the permission event is always a
   *  permission (no elicitation notification). `turn-failed` classifies the
   *  StopFailure so Kimi can reach `rate_limited` rather than a generic error.
   *
   *  That buys the badge only, deliberately: auto-resume
   *  (`daemon/quota-resume.ts`) needs a reset timestamp from a vendor usage
   *  API, Kimi has none and the payload carries no reset time, and guessing a
   *  rolling 5-hour window would resume early and fail again. Pinned in
   *  `test/daemon/quota-resume.test.ts`. */
  activityDetailFromPayload(
    kind: EngineActivityKind,
    payload: Record<string, unknown>,
  ): EngineActivityDetail | undefined {
    if (kind === "turn-failed") return kimiFailureDetail(payload)
    if (kind === "awaiting-input") return { waiting: "permission" }
    if (kind === "tool-pre" || kind === "tool-post" || kind === "tool-failed") {
      return { tool: { ...(typeof payload.tool_name === "string" ? { name: payload.tool_name } : {}) } }
    }
    return undefined
  }

  /** Kimi pipes `session_id` on every hook; no transcript_path. */
  sessionFromPayload(payload: Record<string, unknown>): EngineSessionRef | undefined {
    if (typeof payload.session_id !== "string" || !payload.session_id) return undefined
    return { sessionId: payload.session_id }
  }

  async installActivityHooks(settingsFilePath: string, opts: { toolEvents?: boolean } = {}): Promise<HookEditOutcome> {
    // No config dir = no Kimi; don't materialize ~/.kimi-code. Not a refusal.
    if (!existsSync(dirname(settingsFilePath))) return { ok: true }
    await editTomlConfig(settingsFilePath, (cur) => mergeKimiHooks(cur, true, undefined, opts))
    return { ok: true }
  }

  async removeActivityHooks(settingsFilePath: string): Promise<void> {
    if (!existsSync(settingsFilePath)) return
    await editTomlConfig(settingsFilePath, (cur) => mergeKimiHooks(cur, false))
  }

  supportsWorktreeSync(): boolean {
    return false
  }

  async removeWorktreeSyncHook(): Promise<void> {
    /* Kimi never installed the legacy WorktreeCreate hook. */
  }

  async removeWorktreeWatchHook(): Promise<void> {
    /* Kimi never installed the PostToolUse watch hook. */
  }
}

/** Read → transform → write a TOML config, skipping the write when the
 *  transform is a no-op. Best-effort: never blocks a launch (same contract
 *  as `json-hook-adapter.ts#editJsonSettings`). */
async function editTomlConfig(path: string, transform: (current: string) => string): Promise<void> {
  try {
    let current = ""
    try {
      current = await readFile(path, "utf8")
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) return
    }
    const next = transform(current)
    if (next === current) return
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, next)
  } catch {
    /* best-effort — never block launch */
  }
}
