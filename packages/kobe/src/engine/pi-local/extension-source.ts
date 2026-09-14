/**
 * The Rove activity extension Rove WRITES into a pi-family agent directory —
 * the pi/omp half of the hook channel, as source text.
 *
 * Why a generated file instead of a settings merge: the pi family has no
 * hook TABLE to edit (unlike Claude's `settings.json` or Kimi's
 * `config.toml`). Its extension points are TypeScript modules discovered from
 * `<agentDir>/extensions/*.ts`, verified in the installed 0.80.6 (pi) and
 * 18.1.17 (omp) binaries on 2026-09-11 — both load the module, call its
 * default export, and dispatch these event names through the SAME
 * `pi.on(name, handler)` surface. Both also expose `pi.exec(command, args)`,
 * which spawns with the engine's environment inherited, so `kobe hook` still
 * finds the daemon socket and the tab env vars Rove launched the engine with.
 *
 * `pi.exec` cannot pipe stdin (its `stdio` is fixed to `["ignore","pipe",
 * "pipe"]`), which is why the payload rides argv through `kobe hook
 * --payload <json>` rather than Claude's stdin channel.
 *
 * The event set below is the INTERSECTION of the two APIs — no pi-only
 * `agent_settled`, no omp-only `session_stop` — so one file serves both
 * engines and neither logs an unknown-event warning:
 *
 *   session_start          → session-start
 *   turn_start             → turn-start              (running)
 *   agent_end              → turn-complete           (end of the user's turn)
 *   message_end (assistant) → turn-failed / turn-interrupted, from stopReason
 *   auto_retry_end         → turn-failed             (the retries are exhausted)
 *   tool_approval_requested→ awaiting-input          (blocked on a human)
 *   tool_approval_resolved → turn-start              (the engine resumed)
 *   session_shutdown       → session-end
 *   tool_call / tool_result → tool-pre / tool-post   (volume-gated)
 *   session_before_compact / session_compact → pre-compact / post-compact
 */

import type { VendorId } from "../../types/vendor.ts"

export interface ExtensionSourceOptions {
  readonly vendor: VendorId
  /** argv prefix that reaches `kobe hook <verb>` (see `cli/invocation.ts`). */
  readonly invocation: readonly string[]
  /** Install the high-volume tool family too (plugin-gated by the caller). */
  readonly toolEvents?: boolean
}

/**
 * Render the extension module. Pure: the same options always produce the same
 * bytes, which is what lets the installer skip the write when nothing changed.
 */
export function renderPiExtensionSource(opts: ExtensionSourceOptions): string {
  const { vendor, invocation, toolEvents = false } = opts
  const tool = toolEvents ? TOOL_SECTION : ""
  return `/**
 * Rove activity hook — GENERATED, installed and rewritten by Rove on every
 * launch (${vendor}). Local edits are overwritten; to stop reporting, delete
 * this file or turn Rove's global hooks off.
 *
 * It subscribes to ${vendor}'s session/agent lifecycle and shells out to
 * \`${invocation.join(" ")} hook <verb> --engine ${vendor}\`. Best-effort by
 * construction: every report is fire-and-forget (except the final one, which
 * is awaited so it survives process exit) and every failure is swallowed —
 * a badge must never break a turn.
 */

const ENGINE = ${JSON.stringify(vendor)}
const INVOCATION = ${JSON.stringify(invocation)}

/** Normalize an untrusted field: the CLI's payload types are wider than ours. */
function text(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function field(value, key) {
  if (!value || typeof value !== "object") return undefined
  return value[key]
}

/** Session identity + cwd, read off the hook context (absent fields omitted). */
function context(ctx) {
  const out = {}
  const sm = field(ctx, "sessionManager")
  try {
    const id = text(field(sm, "getSessionId") && sm.getSessionId())
    if (id) out.session_id = id
    const file = text(field(sm, "getSessionFile") && sm.getSessionFile())
    if (file) out.transcript_path = file
  } catch {
    /* a context that cannot answer is simply unidentified */
  }
  const cwd = text(field(ctx, "cwd"))
  if (cwd) out.cwd = cwd
  return out
}

function emit(pi, verb, ctx, extra, wait) {
  try {
    const payload = Object.assign(context(ctx), extra)
    const args = INVOCATION.slice(1).concat([
      "hook",
      verb,
      "--engine",
      ENGINE,
      "--payload",
      JSON.stringify(payload),
    ])
    const run = pi.exec(INVOCATION[0], args)
    // Every spawn is fire-and-forget EXCEPT the final session-end, which is
    // returned so the hook runner awaits it before the process exits. The
    // rejection is handled either way: a failed hook must not surface as an
    // engine error.
    if (run && typeof run.catch === "function") run.catch(() => {})
    return wait ? run : undefined
  } catch {
    /* never let observability break the engine */
  }
}

export default function (pi) {
  pi.on("session_start", (_event, ctx) => emit(pi, "session-start", ctx))
  pi.on("turn_start", (_event, ctx) => emit(pi, "turn-start", ctx))
  pi.on("agent_end", (event, ctx) => {
    // A continuation is already scheduled (auto-retry, queued follow-up), so
    // this is not the end of the user's turn — reporting completion here would
    // light the "done" lamp and immediately clear it.
    if (field(event, "willContinue") === true) return
    emit(pi, "turn-complete", ctx)
  })
  pi.on("message_end", (event, ctx) => {
    const message = field(event, "message")
    if (field(message, "role") !== "assistant") return
    const stopReason = field(message, "stopReason")
    // The provider call itself failed, or the user interrupted it. Both are
    // turn EDGES the completion path cannot see (no agent_end follows a
    // failed request on pi, and an abort reports through the message).
    if (stopReason === "error") {
      emit(pi, "turn-failed", ctx, { error_message: field(message, "errorMessage") })
    } else if (stopReason === "aborted") {
      emit(pi, "turn-interrupted", ctx)
    }
  })
  pi.on("auto_retry_end", (event, ctx) => {
    if (field(event, "success") === false) {
      emit(pi, "turn-failed", ctx, { error_message: field(event, "finalError") })
    }
  })
  // Not gated on the tool family below: the question tool blocks on a human
  // exactly like an approval prompt does (omp's own title goes to \`π !\`), and
  // this spawns only for that one tool, so it costs nothing per ordinary call.
  pi.on("tool_call", (event, ctx) => {
    if (field(event, "toolName") === "ask") emit(pi, "awaiting-input", ctx, { waiting: "input" })
  })
  pi.on("tool_approval_requested", (_event, ctx) => emit(pi, "awaiting-input", ctx, { waiting: "permission" }))
  pi.on("tool_approval_resolved", (_event, ctx) => {
    // Approved or denied, the engine resumes the same turn — which is the
    // "running" state Rove's reducer reads out of turn-start.
    emit(pi, "turn-start", ctx)
  })
  pi.on("session_before_compact", (_event, ctx) => emit(pi, "pre-compact", ctx))
  pi.on("session_compact", (_event, ctx) => emit(pi, "post-compact", ctx))
  pi.on("session_shutdown", (_event, ctx) => emit(pi, "session-end", ctx, undefined, true))
${tool}}
`
}

const TOOL_SECTION = `  pi.on("tool_call", (event, ctx) =>
    emit(pi, "tool-pre", ctx, { tool_name: field(event, "toolName") }),
  )
  pi.on("tool_result", (event, ctx) =>
    emit(pi, field(event, "isError") === true ? "tool-failed" : "tool-post", ctx, {
      tool_name: field(event, "toolName"),
    }),
  )
`
