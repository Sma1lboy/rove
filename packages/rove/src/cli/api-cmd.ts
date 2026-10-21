/**
 * `rove api <verb>` — the scriptable control surface for agents. Each
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
 *     `nextCommandArgs` (argv for the same `rove` executable, runnable
 *     verbatim) so an agent caller can self-heal without parsing prose.
 *   - `--pretty` → indent stdout JSON (humans only)
 *   - `--help`   → render that verb's usage to stdout, exit 0
 *   - `--envelope` → both outcomes as one `{ apiVersion, ok, result | error }`
 *     on stdout, the shape the daemon's and bridge's `api.invoke` return
 *     (exit codes unchanged). The executor is shared: `api/invoke.ts`.
 */

import { errorMessage } from "@/lib/error-message"
import { type ApiEnvelope, ROVE_API_VERSION } from "@sma1lboy/rove-daemon/daemon/protocol"
import { ensurePluginEnginesLoaded } from "../engine/plugin-engines.ts"
import {
  AUTO_MACHINE,
  LOCAL_MACHINE,
  forwardVerb,
  pickMachine,
  repoHosts,
  requireMachine,
  routeTarget,
} from "../machines/forward.ts"
import type { MachineEntry } from "../machines/registry.ts"
import { takeIdentityWarning } from "./api/dispatcher.ts"
import { VerbArgs, buildCountPlan, parseAgentsSpec, parseFlags, validateAgainstSpec } from "./api/flags.ts"
import { forwardParams, takeMachineFlag } from "./api/forward-cli.ts"
import {
  booleanFlagsOf,
  callVerb,
  errorBody,
  errorEnvelope,
  executeVerb,
  repeatableFlagsOf,
  runVerb,
  successEnvelope,
  toApiError,
} from "./api/invoke.ts"
import { defaultApiRuntime, deliverPrompt } from "./api/runtime.ts"
import { API_SCHEMA_VERSION, apiUsage, fullSchema, schemaIndex, verbHelp, verbSchema } from "./api/schema.ts"
import { ApiError } from "./api/types.ts"
import type { ApiRuntime, DeliveredPrompt, ParsedArgs, PromptDeliveryOps, PromptTarget, VerbSpec } from "./api/types.ts"
import { API_VERBS, VERBS, VERB_GROUPS, findVerb, unknownVerbError } from "./api/verbs.ts"
import { argvHasFlag } from "./argv.ts"
import { type DaemonSession, openDaemonSession } from "./daemon-session.ts"
import type { DaemonRpc } from "./daemon-session.ts"

/** `--envelope`: every outcome is one {@link ApiEnvelope} on stdout, as over the socket and bridge. */
let envelopeMode = false

function writeJson(value: unknown, pretty: boolean, stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(`${pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`)
}

function emit(value: unknown, pretty: boolean): void {
  // An UNVERIFIED $ROVE_TASK_ID still succeeds, minus the dispatcher; the
  // notice rides the result because stderr is reserved for the one JSON
  // error envelope (docs/API.md).
  const warning = takeIdentityWarning()
  // Objects only — spreading an array would flatten it into numeric keys.
  const mergeable = warning && value && typeof value === "object" && !Array.isArray(value)
  const payload = mergeable ? { ...value, identityWarning: warning } : value
  writeJson(envelopeMode ? successEnvelope(payload) : payload, pretty)
}

function fail(message: string, code: string, exitCode = 1, data?: Record<string, unknown>): never {
  // Merge any error `data` (e.g. a taskId from a create-then-deliver failure)
  // into the error object so a script never loses an already-created task.
  const error = errorBody(new ApiError(message, code, data))
  if (envelopeMode) writeJson({ apiVersion: ROVE_API_VERSION, ok: false, error }, false)
  else writeJson({ error }, false, process.stderr)
  process.exit(exitCode)
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
  "UNKNOWN_MACHINE",
])

/**
 * Parse + validate + run ONE verb against an injected client/runtime — the
 * unit-test (and embedding) entry. Throws {@link ApiError} instead of
 * exiting; `runApiSubcommand` keeps the process-exit/JSON-emit wrapper.
 */
export async function invokeVerb(
  verbName: string,
  argv: readonly string[],
  deps: { client: DaemonRpc | null; runtime?: ApiRuntime },
): Promise<unknown> {
  return runVerb(verbName, { argv }, deps)
}

export async function runApiSubcommand(argv: readonly string[]): Promise<void> {
  const [verbName, ...withMachine] = argv
  const { machine, rest } = takeMachineFlag(withMachine)
  envelopeMode = argvHasFlag(rest, "--envelope")
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

  let parsed: ParsedArgs
  try {
    parsed = parseFlags(rest, booleanFlagsOf(verb), repeatableFlagsOf(verb))
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

  // An explicit other machine needs nothing from this machine's daemon.
  // `--machine auto` places the work: the least-busy machine, this one on a tie.
  if (machine === AUTO_MACHINE) {
    const { RoveDaemonClient } = await import("@sma1lboy/rove-daemon/client")
    const { defaultDaemonSocketPath } = await import("@sma1lboy/rove-daemon/daemon/paths")
    const local = new RoveDaemonClient(defaultDaemonSocketPath())
    const picked = await pickMachine(
      () =>
        local
          .request<{ tasks?: Array<{ status?: string }> }>("task.list")
          .then((res) => res.tasks ?? [])
          .finally(() => local.close()),
      undefined,
      undefined,
      repoHosts(forwardParams(verb, parsed.flags)),
    )
    const skipped = picked.skipped?.length ? `; without the repo: ${picked.skipped.join(", ")}` : ""
    process.stderr.write(
      `rove api: --machine auto → ${picked.entry?.alias ?? LOCAL_MACHINE} (in progress: ${Object.entries(picked.loads)
        .map(([name, n]) => `${name} ${n}`)
        .join(", ")}${skipped})\n`,
    )
    const entry = picked.entry
    if (entry) {
      await runForwarded(verb, parsed, async () => entry)
      return
    }
  } else if (machine !== undefined && machine !== LOCAL_MACHINE) {
    await runForwarded(verb, parsed, async () => requireMachine(machine))
    return
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

  // A `--task-id` on ANOTHER machine runs there: the local daemon would
  // answer TASK_NOT_FOUND for a task the user can see in the sidebar.
  // Opens no other socket when no machine is registered.
  const taskId = machine === LOCAL_MACHINE ? undefined : parsed.flags.get("task-id")
  const client = session?.client ?? null
  const target = taskId && client ? await machineHolding(taskId, client) : null
  if (target) {
    session?.close()
    await runForwarded(verb, parsed, async () => target)
    return
  }

  try {
    const result = await callVerb(verb, parsed.flags, { client: session?.client ?? null })
    emit(result, parsed.pretty)
  } catch (err) {
    // PARTIAL_FANOUT carries a full result payload (created tasks + failures)
    // that MUST reach the script — emit it to stdout, then exit 3 so the
    // "non-zero = something failed" contract holds without losing the data.
    // SKIPPED (`should-run`, `send --if-runnable`) is the same shape: the
    // verdict is the answer, and exit 3 says "don't".
    if (err instanceof ApiError && (err.code === "PARTIAL_FANOUT" || err.code === "SKIPPED")) {
      if (envelopeMode) writeJson(errorEnvelope(err), parsed.pretty)
      else emit(err.data, parsed.pretty)
      session?.close()
      process.exit(3)
    }
    const apiErr = toApiError(err)
    fail(apiErr.message, apiErr.code, USAGE_ERROR_CODES.has(apiErr.code) ? 2 : 1, apiErr.data)
  } finally {
    session?.close()
  }
}

async function machineHolding(taskId: string, client: DaemonRpc): Promise<MachineEntry | null> {
  try {
    return await routeTarget({
      taskId,
      isLocalTask: async (id) => {
        try {
          await client.request("task.get", { taskId: id })
          return true
        } catch {
          return false
        }
      },
    })
  } catch (err) {
    const apiErr = toApiError(err)
    fail(apiErr.message, apiErr.code, 1, apiErr.data)
  }
}

/** Run the verb in another machine's daemon and print its outcome as if it ran here. */
async function runForwarded(verb: VerbSpec, parsed: ParsedArgs, resolve: () => Promise<MachineEntry>): Promise<void> {
  let envelope: ApiEnvelope
  try {
    const entry = await resolve()
    envelope = await forwardVerb(entry, verb.name, forwardParams(verb, parsed.flags))
  } catch (err) {
    const apiErr = toApiError(err)
    fail(apiErr.message, apiErr.code, USAGE_ERROR_CODES.has(apiErr.code) ? 2 : 1, apiErr.data)
  }
  if (envelope.ok) {
    emit(envelope.result, parsed.pretty)
    return
  }
  const { message, code, ...data } = envelope.error
  if (code === "PARTIAL_FANOUT" || code === "SKIPPED") {
    // Same contract as a local fan-out or skip: the payload on stdout, exit 3.
    if (envelopeMode) writeJson(envelope, parsed.pretty)
    else emit(data, parsed.pretty)
    process.exit(3)
  }
  fail(message, code, USAGE_ERROR_CODES.has(code) ? 2 : 1, data)
}

// `./api-cmd.ts` is the stable import path for tests + embedders.
export {
  API_SCHEMA_VERSION,
  API_VERBS,
  ApiError,
  executeVerb,
  toApiError,
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
