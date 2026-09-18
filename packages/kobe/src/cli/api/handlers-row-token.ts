/**
 * `row-token` — put one label on a task row, with a deadline.
 *
 * The plugin-facing half of `row-tokens.ts`: a plugin (or any script) writes
 * a short label into its own slot on a task row, and that label FADES when
 * its TTL runs out rather than outliving the process that wrote it. See
 * docs/PLUGIN-AUTHORING.md § Task-row tokens for what a plugin may say here
 * and what stays host-owned.
 */

import { ROW_TOKEN_MAX_TEXT, ROW_TOKEN_TONES } from "@sma1lboy/kobe-daemon/daemon/row-tokens"
import { F } from "./flags.ts"
import { simpleRpc } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

/** Default TTL in seconds, mirroring the store's own default. */
const DEFAULT_TTL_SECONDS = 60

/**
 * Who is writing. The host injects `ROVE_PLUGIN_ID` into every plugin
 * command, so a plugin's tokens are attributed and quota'd without the
 * plugin having to name itself; a plain shell writes as `cli`.
 */
function sourceOf(env: NodeJS.ProcessEnv = process.env): string {
  return env.ROVE_PLUGIN_ID ?? env.KOBE_PLUGIN_ID ?? "cli"
}

async function rowToken(ctx: VerbContext): Promise<unknown> {
  const { args } = ctx
  const taskId = args.require("task-id")
  const clear = args.bool("clear") === true
  const text = args.str("text")
  if (!clear && !text) throw new ApiError("row-token needs --text, or --clear to remove one", "MISSING_TEXT")
  const key = args.str("key")
  const tone = args.str("tone")
  const ttl = args.int("ttl")
  return simpleRpc(ctx, "task.rowToken", {
    taskId,
    source: sourceOf(),
    ...(key ? { key } : {}),
    ...(clear ? { clear: true } : { text, ...(tone ? { tone } : {}) }),
    ...(ttl !== undefined ? { ttlMs: ttl * 1000 } : {}),
  })
}

export const ROW_TOKEN_VERB: VerbSpec = {
  name: "row-token",
  group: "drive",
  summary: `Put one short label on a task's sidebar/board row, with a TTL — the surface a coordination plugin paints its own state on. Every token EXPIRES (default ${DEFAULT_TTL_SECONDS}s, max 1h): a plugin refreshes the label to keep it, and one that dies has its labels fade instead of leaving stale state on screen. A plugin writes into its own slot (\`ROVE_PLUGIN_ID\` + --key, 2 slots per plugin per task) and can say nothing else: the derived group, the activity badge, the PR chip, the title and the branch are host-owned. \`--tone\` names a ROLE, not a colour, so the active theme still decides how it looks. Text is trimmed to ${ROW_TOKEN_MAX_TEXT} characters. Returns { ok, token } (or { ok, cleared } with --clear).`,
  flags: [
    F.taskId(true),
    {
      name: "text",
      type: "string",
      placeholder: "LABEL",
      description: `The label, trimmed to ${ROW_TOKEN_MAX_TEXT} characters. Required unless --clear.`,
    },
    {
      name: "ttl",
      type: "int",
      default: String(DEFAULT_TTL_SECONDS),
      placeholder: "SECONDS",
      description: "How long the label survives without a refresh (1…3600, clamped).",
    },
    {
      name: "key",
      type: "string",
      default: "default",
      placeholder: "SLOT",
      description: "Which of your two slots on this row to write. Writing the same key again replaces the token.",
    },
    {
      name: "tone",
      type: "enum",
      values: ROW_TOKEN_TONES,
      description: "Semantic role the theme colours. Omitted = the row's own muted tone.",
    },
    {
      name: "clear",
      type: "bool",
      description: "Remove the token at --key now, or every token of yours on this row when --key is omitted.",
    },
  ],
  handler: rowToken,
}
