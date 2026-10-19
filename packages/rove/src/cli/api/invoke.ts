/**
 * The one verb executor behind every transport: `rove api` (argv), the
 * daemon's `api.invoke` and the bridge's `api.invoke` (params). Parsing,
 * validation, error normalization and the envelope live here; a transport only
 * frames what comes back.
 */

import { errorMessage } from "@/lib/error-message"
import {
  type ApiEnvelope,
  type ApiErrorBody,
  type ApiParams,
  ROVE_API_VERSION,
} from "@sma1lboy/rove-daemon/daemon/protocol"
import { ensurePluginEnginesLoaded } from "../../engine/plugin-engines.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { VerbArgs, parseFlags, validateAgainstSpec } from "./flags.ts"
import { defaultApiRuntime } from "./runtime.ts"
import {
  type ApiCaller,
  ApiError,
  type ApiRuntime,
  type FlagSpec,
  type Flags,
  type VerbSpec,
  cliCaller,
  splitDaemonCode,
} from "./types.ts"
import { findVerb, unknownVerbError } from "./verbs.ts"

export type VerbInput = { readonly argv: readonly string[] } | { readonly params: ApiParams }

export interface VerbDeps {
  readonly client: DaemonRpc | null
  readonly runtime?: ApiRuntime
  /** Defaults to the CLI process itself. */
  readonly caller?: ApiCaller
}

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

/** The CLI's stderr `error` object and every envelope's `error`: one shape. */
export function errorBody(err: ApiError): ApiErrorBody {
  return { message: err.message, code: err.code, ...err.data }
}

export function successEnvelope(result: unknown): ApiEnvelope {
  return { apiVersion: ROVE_API_VERSION, ok: true, result }
}

export function errorEnvelope(err: unknown): ApiEnvelope {
  return { apiVersion: ROVE_API_VERSION, ok: false, error: errorBody(toApiError(err)) }
}

function flagText(name: string, type: FlagSpec["type"] | undefined, value: ApiParams[string]): string {
  if (typeof value === "string") return value
  if (typeof value === "boolean" && (type === "bool" || type === undefined)) return String(value)
  if (typeof value === "number" && (type === "int" || type === "uint" || type === undefined)) return String(value)
  if (Array.isArray(value) && (type === "csv" || type === undefined)) {
    if (!value.every((item) => typeof item === "string" && !item.includes(","))) {
      throw new ApiError(`param ${name} must be a list of strings without ","`, "BAD_FLAG")
    }
    return value.join(",")
  }
  throw new ApiError(`param ${name} does not fit its ${type} flag`, "BAD_FLAG")
}

/** Params keyed by flag name → the flag map argv parsing builds; undeclared names reach validation as-is. */
export function paramsToFlags(verb: VerbSpec, params: ApiParams): Flags {
  const flags: Flags = new Map()
  for (const [name, value] of Object.entries(params)) {
    flags.set(name, flagText(name, verb.flags.find((f) => f.name === name)?.type, value))
  }
  return flags
}

export function booleanFlagsOf(verb: VerbSpec): ReadonlySet<string> {
  return new Set(verb.flags.filter((f) => f.type === "bool").map((f) => f.name))
}

/** Run a resolved, validated verb; every failure leaves as an {@link ApiError}. */
export async function callVerb(verb: VerbSpec, flags: Flags, deps: VerbDeps): Promise<unknown> {
  const caller = deps.caller ?? cliCaller()
  try {
    return await verb.handler({
      args: new VerbArgs(verb, flags, caller),
      caller,
      client: deps.client,
      runtime: deps.runtime ?? defaultApiRuntime,
    })
  } catch (err) {
    throw toApiError(err)
  }
}

/** Resolve, parse, validate and run one verb. Throws {@link ApiError}. */
export async function runVerb(verbName: string, input: VerbInput, deps: VerbDeps): Promise<unknown> {
  // Before any verb runs: `--command fake-coder` must resolve to the plugin's
  // engine, not `generic`.
  ensurePluginEnginesLoaded()
  const verb = findVerb(verbName)
  if (!verb) throw unknownVerbError(verbName)
  if (verb.cliOnly && !(deps.caller ?? cliCaller()).cli) {
    throw new ApiError(`"${verbName}" streams over stdout/stdin, so only \`rove api\` can run it`, "CLI_ONLY_VERB", {
      hint: "run it as a CLI command on the machine whose daemon you are talking to",
    })
  }
  const flags = "argv" in input ? parseFlags(input.argv, booleanFlagsOf(verb)).flags : paramsToFlags(verb, input.params)
  validateAgainstSpec(verb, flags)
  return callVerb(verb, flags, deps)
}

/** {@link runVerb} as an envelope: never rejects. */
export async function executeVerb(verbName: string, input: VerbInput, deps: VerbDeps): Promise<ApiEnvelope> {
  try {
    return successEnvelope(await runVerb(verbName, input, deps))
  } catch (err) {
    return errorEnvelope(err)
  }
}
