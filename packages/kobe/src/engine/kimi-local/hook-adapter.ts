/**
 * Kimi Code hook adapter (docs/design/plugin-events.md "Kimi adapter") — the
 * third real {@link EngineHookAdapter}.
 *
 * Kimi's hook store is NOT the shared settings.json shape: it's TOML
 * `[[hooks]]` tables in `~/.kimi-code/config.toml` (keys: event, matcher?,
 * command, timeout; JSON payload via stdin with `session_id` + `cwd`;
 * MoonshotAI kimi-cli docs/en/customization/hooks.md, verified against the
 * installed 0.37.2 binary). So this adapter can't extend {@link JsonHookAdapter};
 * it implements the same contract over a marker-delimited TOML block —
 * remove-then-append between `# >>> rove hooks` / `# <<< rove hooks`, which is
 * merge-safe (the user's config outside the block is never parsed or
 * rewritten) and idempotent (identical content skips the write).
 *
 * Event map notes (vs Claude's):
 *   - `Interrupt` → turn-interrupted: Kimi does NOT fire Stop after a user
 *     interrupt, so without this an interrupted Kimi turn strands in
 *     `running` (the reducer already handles the verb; plugin-events.md §B).
 *   - `PermissionRequest` → awaiting-input: unlike Codex (where the same
 *     event is a synchronous allow/deny decision hook kobe stays away from),
 *     Kimi runs it as a plain command hook — an exit-0 observer is safe.
 *   - `Notification` is NOT wired: Kimi's notification types are
 *     undocumented, and an unfiltered install would mark every idle prompt
 *     as needs-input (the exact trap Claude's `permission_prompt` matcher
 *     exists to avoid).
 *   - Worktree-watch is NOT wired: kobe's observer matches the `Bash` tool
 *     name, and Kimi's shell-tool naming is unverified. The daemon's
 *     session-start auto-adopt still covers Kimi-created worktrees.
 */

import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { kobeHookInvocation } from "../../cli/invocation.ts"
import { quoteShellArgv } from "../../lib/shell-command.ts"
import type { EngineHookAdapter, EngineSessionRef } from "../hook-adapter.ts"
import type { EngineActivityDetail, EngineActivityKind } from "../hook-events.ts"
import { GATED_TOOL_VERBS, type HookEventSpec } from "../json-hooks.ts"

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

/** Where Kimi reads its config (the hooks live inline in config.toml).
 *  `KIMI_CODE_HOME` is the same override `kimi-local/history.ts` honors. */
export function kimiConfigPath(home: string = homedir()): string {
  const override = process.env.KIMI_CODE_HOME?.trim()
  return join(override && override.length > 0 ? override : join(home, ".kimi-code"), "config.toml")
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
    const command = quoteShellArgv([...inv, "hook", spec.verb, "--engine", "kimi"])
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

export class KimiHookAdapter implements EngineHookAdapter {
  readonly vendor = "kimi" as const

  supportsHooks(): boolean {
    return true
  }

  globalSettingsPath(): string {
    return kimiConfigPath()
  }

  /** Kimi's stdin payload spells tool fields `tool_name`; the permission
   *  event is always a permission (Kimi has no elicitation notification). */
  activityDetailFromPayload(
    kind: EngineActivityKind,
    payload: Record<string, unknown>,
  ): EngineActivityDetail | undefined {
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

  async installActivityHooks(settingsFilePath: string, opts: { toolEvents?: boolean } = {}): Promise<void> {
    // Don't materialize ~/.kimi-code for a user who never installed Kimi —
    // no config dir means no Kimi to read the hooks anyway.
    if (!existsSync(dirname(settingsFilePath))) return
    await editTomlConfig(settingsFilePath, (cur) => mergeKimiHooks(cur, true, undefined, opts))
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

  async installWorktreeWatchHook(): Promise<void> {
    /* Not wired — see module doc (Bash tool-name matcher unverified). */
  }

  async removeWorktreeWatchHook(): Promise<void> {
    /* Never installed. */
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
