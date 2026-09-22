/**
 * `kobe api <verb>` — the scriptable control surface for agents. Each
 * invocation connects to (or auto-starts) the daemon, prints one JSON object,
 * and exits; read-only verbs like `schema` skip the daemon entirely.
 *
 * {@link VERBS} is the single source of truth: each entry's spec drives the
 * `schema` verb, per-verb `--help`, and flag validation. Handlers receive a
 * {@link VerbContext}: spec-typed flags ({@link VerbArgs} — no re-validation
 * inside handlers), the narrow {@link DaemonRpc} (faked in tests), and the
 * {@link ApiRuntime} side-effect seam.
 *
 * ## Output contract
 *   - success → one JSON object to stdout, `\n` terminated, exit 0
 *   - error   → `{ "error": { "message", "code", ...data } }` to stderr, exit ≠ 0.
 *     High-traffic rejections additionally carry `hint` (what to do) and
 *     `nextCommandArgs` (argv for the same `kobe` executable, runnable
 *     verbatim) so an agent caller can self-heal without parsing prose.
 *   - `--pretty` → indent stdout JSON (humans only)
 *   - `--help`   → render that verb's usage to stdout, exit 0
 */

import { errorMessage } from "@/lib/error-message"
import { ensurePluginEnginesLoaded } from "../engine/plugin-engines.ts"
import { takeIdentityWarning } from "./api/dispatcher.ts"
import { VerbArgs, buildCountPlan, parseAgentsSpec, parseFlags, validateAgainstSpec } from "./api/flags.ts"
import { defaultApiRuntime, deliverPrompt } from "./api/runtime.ts"
import { API_SCHEMA_VERSION, apiUsage, fullSchema, schemaIndex, verbHelp, verbSchema } from "./api/schema.ts"
import { ApiError, splitDaemonCode } from "./api/types.ts"
import type {
  ApiRuntime,
  DeliveredPrompt,
  Flags,
  ParsedArgs,
  PromptDeliveryOps,
  PromptTarget,
  VerbContext,
  VerbSpec,
} from "./api/types.ts"
import { API_VERBS, VERBS, VERB_GROUPS, findVerb, unknownVerbError } from "./api/verbs.ts"
import { type DaemonSession, openDaemonSession } from "./daemon-session.ts"
import type { DaemonRpc } from "./daemon-session.ts"

function emit(value: unknown, pretty: boolean): void {
  // An UNVERIFIED $ROVE_TASK_ID still succeeds, minus the dispatcher; the
  // notice rides the result because stderr is reserved for the one JSON
  // error envelope (docs/API.md).
  const warning = takeIdentityWarning()
  // Objects only — spreading an array would flatten it into numeric keys.
  const mergeable = warning && value && typeof value === "object" && !Array.isArray(value)
  const payload = mergeable ? { ...value, identityWarning: warning } : value
  const text = pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload)
  process.stdout.write(`${text}\n`)
}

function fail(message: string, code: string, exitCode = 1, data?: Record<string, unknown>): never {
  // Merge any error `data` (e.g. a taskId from a create-then-deliver failure)
  // into the error object so a script never loses an already-created task.
  process.stderr.write(`${JSON.stringify({ error: { message, code, ...data } })}\n`)
  process.exit(exitCode)
}

function makeContext(verb: VerbSpec, flags: Flags, client: DaemonRpc | null, runtime: ApiRuntime): VerbContext {
  return { args: new VerbArgs(verb, flags), client, runtime }
}

/**
 * Codes the exit-code contract (docs/API.md) calls a USAGE error (exit 2):
 * argv is wrong, nothing was attempted. A HANDLER rejecting its own arguments
 * (`schema --verb nope`) must exit 2 like the pre-dispatch validators do.
 */
const USAGE_ERROR_CODES: ReadonlySet<string> = new Set([
  "BAD_VERB",
  "UNKNOWN_VERB",
  "BAD_FLAG",
  "MISSING_FLAG",
  "MISSING_VERB",
  "BAD_DAEMON",
])

/**
 * Normalize any handler/RPC failure into an {@link ApiError}. The daemon's
 * prose `task not found: <id>` becomes typed `TASK_NOT_FOUND` with the
 * recovery command (the most common scripted-caller failure).
 *
 * Any other already-CODED error has its code lifted into `code` (prefix
 * stripped) rather than flattened to `RPC_ERROR` — a per-code allowlist would
 * let new codes like `delete`'s `DIRTY_WORKTREE` reach callers untyped.
 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  const message = errorMessage(err)
  if (/task not found/i.test(message)) {
    return new ApiError(message, "TASK_NOT_FOUND", {
      hint: "that task id does not exist (deleted or mistyped) — list live tasks and retry with a real id",
      nextCommandArgs: ["api", "list"],
    })
  }
  if (/unknown daemon request:/i.test(message)) return versionSkewError(message)
  const coded = splitDaemonCode(message)
  if (coded) return new ApiError(coded.rest, coded.code)
  return new ApiError(message, "RPC_ERROR")
}

/**
 * The daemon rejected the RPC the verb is BUILT on — which only happens when
 * this CLI and the long-lived daemon are different builds. It is a version
 * skew, not a broken verb, and the recovery is the same in both directions:
 *
 *   - new CLI × old daemon — the daemon predates the verb.
 *   - old CLI × new daemon — the daemon dropped a verb this CLI still ships.
 *
 * Typed because `schema` (served by this CLI) can advertise a verb the daemon
 * rejects; a bare `RPC_ERROR` would read as "retry" rather than "these builds
 * disagree about what exists".
 */
function versionSkewError(message: string): ApiError {
  return new ApiError(message, "DAEMON_VERSION_SKEW", {
    hint: "the running daemon is a different build than this CLI, so it does not serve this verb — restart the daemon to pick up this build, then retry (if the verb is gone for good, `rove api schema` lists what this daemon actually serves)",
    nextCommandArgs: ["daemon", "restart"],
  })
}

/**
 * Parse + validate + run ONE verb against an injected client/runtime —
 * the unit-test (and embedding) entry. Throws {@link ApiError} instead of
 * exiting; `runApiSubcommand` keeps the process-exit/JSON-emit wrapper.
 */
export async function invokeVerb(
  verbName: string,
  argv: readonly string[],
  deps: { client: DaemonRpc | null; runtime?: ApiRuntime },
): Promise<unknown> {
  const verb = findVerb(verbName)
  if (!verb) throw unknownVerbError(verbName)
  const booleanFlags = new Set(verb.flags.filter((f) => f.type === "bool").map((f) => f.name))
  const parsed = parseFlags(argv, booleanFlags)
  validateAgainstSpec(verb, parsed.flags)
  try {
    return await verb.handler(makeContext(verb, parsed.flags, deps.client, deps.runtime ?? defaultApiRuntime))
  } catch (err) {
    throw toApiError(err)
  }
}

export async function runApiSubcommand(argv: readonly string[]): Promise<void> {
  const [verbName, ...rest] = argv
  if (!verbName || verbName === "--help" || verbName === "-h" || verbName === "help") {
    if (!verbName) fail(apiUsage(), "MISSING_VERB", 2)
    process.stdout.write(`${apiUsage()}\n`)
    return
  }
  // Before any verb runs: `--command fake-coder` must resolve to the plugin's
  // engine, not `generic`, or the created task loses the identity and screen
  // rules `engine-list` just promised for that id.
  ensurePluginEnginesLoaded()
  const verb = findVerb(verbName)
  if (!verb) {
    const err = unknownVerbError(verbName)
    fail(`${err.message}\n${apiUsage()}`, err.code, 2, err.data)
  }

  const booleanFlags = new Set(verb.flags.filter((f) => f.type === "bool").map((f) => f.name))
  let parsed: ParsedArgs
  try {
    parsed = parseFlags(rest, booleanFlags)
  } catch (err) {
    if (err instanceof ApiError) fail(err.message, err.code, 2, err.data)
    fail(errorMessage(err), "BAD_FLAG", 2)
  }

  if (parsed.help) {
    process.stdout.write(`${verbHelp(verb)}\n`)
    return
  }

  try {
    validateAgainstSpec(verb, parsed.flags)
  } catch (err) {
    if (err instanceof ApiError) fail(err.message, err.code, 2, err.data)
    fail(errorMessage(err), "BAD_FLAG", 2)
  }

  let session: DaemonSession | null = null
  if (!verb.offline) {
    try {
      session = await openDaemonSession()
    } catch (err) {
      fail(`could not reach or start the Rove daemon: ${errorMessage(err)}`, "BAD_DAEMON", 2, {
        hint: "check whether the daemon is up (and why it is not), then retry the same command",
        nextCommandArgs: ["daemon", "status"],
      })
    }
  }

  try {
    // Refuse a `--task-id` on ANOTHER machine here: the local daemon would
    // answer TASK_NOT_FOUND for a task the user can see in the sidebar.
    // Opens no socket when no machine is registered.
    const { assertLocalTask } = await import("../machines/api-merge.ts")
    await assertLocalTask(parsed.flags.get("task-id"))
    const result = await verb.handler(makeContext(verb, parsed.flags, session?.client ?? null, defaultApiRuntime))
    emit(result, parsed.pretty)
  } catch (err) {
    // PARTIAL_FANOUT carries a full result payload (created tasks + failures)
    // that MUST reach the script — emit it to stdout, then exit 3 so the
    // "non-zero = something failed" contract holds without losing the data.
    if (err instanceof ApiError && err.code === "PARTIAL_FANOUT") {
      emit(err.data, parsed.pretty)
      session?.close()
      process.exit(3)
    }
    const apiErr = toApiError(err)
    fail(apiErr.message, apiErr.code, USAGE_ERROR_CODES.has(apiErr.code) ? 2 : 1, apiErr.data)
  } finally {
    session?.close()
  }
}

// `./api-cmd.ts` is the stable import path for tests + embedders.
export {
  API_SCHEMA_VERSION,
  API_VERBS,
  ApiError,
  VERBS,
  VERB_GROUPS,
  VerbArgs,
  apiUsage,
  buildCountPlan,
  deliverPrompt,
  defaultApiRuntime,
  findVerb,
  parseAgentsSpec,
  parseFlags,
  validateAgainstSpec,
  verbHelp,
  schemaIndex,
  verbSchema,
  fullSchema,
}
export type { ApiRuntime, PromptDeliveryOps, PromptTarget, DeliveredPrompt }
