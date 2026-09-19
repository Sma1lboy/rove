/**
 * The Rove activity plugin Rove WRITES into an OpenCode-family config
 * directory — the opencode/kilo half of the hook channel, as source text.
 *
 * Why a generated module instead of a settings merge: these CLIs have no hook
 * TABLE to edit. Their extension point is an ES module discovered from
 * `<config dir>/{plugin,plugins}/*.js`, whose exported function is called once
 * per server start and returns an object of named lifecycle handlers. The two
 * handlers below are the whole surface Rove needs:
 *
 *   chat.message  → a user message entered the session (the turn began)
 *   event         → the CLI's own event bus, one `type` per lifecycle edge
 *
 * Event → verb:
 *
 *   session.created / session.updated  → session-start   (identity)
 *   chat.message, tool/permission/question replies, session.status(active)
 *                                      → turn-start      (running)
 *   permission.asked / question.asked  → awaiting-input   (blocked on a human)
 *   session.error                      → turn-failed
 *   session.idle / session.status(idle) → turn-complete
 *   session.compacted                  → post-compact
 *
 * EXACTLY ONE named export. The loader's legacy path walks every export of the
 * module and registers each one, so a second export (a helper, a constant)
 * either throws "Plugin export is not a function" or registers the plugin
 * twice and doubles every report.
 *
 * `tool.execute.before` / `.after` are deliberately NOT subscribed: they would
 * only re-assert "running", once per tool call, at the cost of a process spawn
 * each time.
 */

import type { VendorId } from "../../types/vendor.ts"
import { ROVE_HOOK_VERSION } from "../json-hooks.ts"

export interface OpencodePluginSourceOptions {
  readonly vendor: VendorId
  /** argv prefix that reaches `kobe hook <verb>` (see `cli/invocation.ts`). */
  readonly invocation: readonly string[]
}

/**
 * Render the plugin module. Pure: the same options always produce the same
 * bytes, which is what lets the installer skip the write when nothing changed.
 */
export function renderOpencodePluginSource(opts: OpencodePluginSourceOptions): string {
  const { vendor, invocation } = opts
  return `/**
 * Rove activity hook — GENERATED, installed and rewritten by Rove on every
 * launch (${vendor}). Local edits are overwritten; to stop reporting, delete
 * this file or turn Rove's global hooks off. Add your own plugins beside it.
 *
 * ROVE_HOOK_VERSION=${ROVE_HOOK_VERSION}
 *
 * It subscribes to ${vendor}'s session lifecycle and shells out to
 * \`${invocation.join(" ")} hook <verb> --engine ${vendor}\`. Best-effort by
 * construction: every report is fire-and-forget and every failure is
 * swallowed — a badge must never break a turn.
 */

import { spawn } from "node:child_process"

const ENGINE = ${JSON.stringify(vendor)}
const INVOCATION = ${JSON.stringify(invocation)}
const HOOK_VERSION = ${JSON.stringify(String(ROVE_HOOK_VERSION))}

/** A running turn, by whichever name this build of the CLI reports. */
const WORKING_STATUS = new Set(["active", "busy", "pending", "retry", "running", "streaming", "working"])

function text(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/**
 * Sub-agent sessions. Their lifecycle edges must not replace the pane's root
 * session id, and their completions must not light the "turn done" lamp while
 * the user's own turn is still running.
 */
const childSessions = new Set()

/** A child session's events that still say something about the ROOT turn:
 *  a nested agent blocked on a human blocks the whole task. */
const CHILD_VERBS = new Map([
  ["permission.asked", "awaiting-input"],
  ["question.asked", "awaiting-input"],
  ["permission.replied", "turn-start"],
  ["question.replied", "turn-start"],
  ["question.rejected", "turn-start"],
])

function emit(cwd, verb, sessionID, extra) {
  try {
    const payload = Object.assign({}, extra)
    if (cwd) payload.cwd = cwd
    if (sessionID) payload.session_id = sessionID
    const args = INVOCATION.slice(1).concat([
      "hook",
      verb,
      "--engine",
      ENGINE,
      "--hook-version",
      HOOK_VERSION,
      "--payload",
      JSON.stringify(payload),
    ])
    const child = spawn(INVOCATION[0], args, { stdio: "ignore", detached: false })
    child.on("error", () => {})
  } catch {
    /* never let observability break the engine */
  }
}

export const RoveAgentState = async (input) => {
  const cwd = text(input && input.directory) || text(input && input.worktree)

  return {
    "chat.message": async ({ sessionID }) => {
      if (sessionID && childSessions.has(sessionID)) return
      emit(cwd, "turn-start", sessionID)
    },
    event: async ({ event }) => {
      const type = event && event.type
      const properties = (event && event.properties) || {}
      const sessionID = text(properties.sessionID)

      const info = properties.info
      if (info && info.id && info.parentID) childSessions.add(info.id)
      if (sessionID && childSessions.has(sessionID)) {
        const verb = CHILD_VERBS.get(type)
        // No session id: a sub-agent's identity must never become the pane's.
        if (verb) emit(cwd, verb, undefined)
        return
      }

      switch (type) {
        case "session.created":
        case "session.updated":
          if (sessionID) emit(cwd, "session-start", sessionID)
          break
        case "session.status": {
          const status = properties.status
          const kind = typeof status === "string" ? status : status && status.type
          const lowered = typeof kind === "string" ? kind.toLowerCase() : undefined
          if (lowered === "idle") emit(cwd, "turn-complete", sessionID)
          else if (lowered && WORKING_STATUS.has(lowered)) emit(cwd, "turn-start", sessionID)
          else if (sessionID) emit(cwd, "session-start", sessionID)
          break
        }
        case "permission.replied":
        case "question.replied":
        case "question.rejected":
          emit(cwd, "turn-start", sessionID)
          break
        case "permission.asked":
          emit(cwd, "awaiting-input", sessionID, { waiting: "permission" })
          break
        case "question.asked":
          emit(cwd, "awaiting-input", sessionID, { waiting: "input" })
          break
        case "session.error":
          emit(cwd, "turn-failed", sessionID, { error_message: text(properties.error) })
          break
        case "session.idle":
          emit(cwd, "turn-complete", sessionID)
          break
        case "session.compacted":
          emit(cwd, "post-compact", sessionID)
          break
        default:
          break
      }
    },
  }
}
`
}
