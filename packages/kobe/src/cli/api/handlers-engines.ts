/**
 * The engine face of `kobe api`: `engine-list` (what can I launch, and with
 * what command?), `set-command` (pin a task's launch command), and
 * `set-effort` (pin its reasoning level).
 *
 * These are the two halves of the dispatch contract. `engine-list` is
 * WYSIWYG on purpose — it prints each entry's raw command line so an agent
 * can copy one, edit a flag, and pass the result straight back as
 * `--command`, without kobe modelling anyone's flags. `set-command` is the
 * write twin: it resolves the command's protocol here (the preset registry
 * lives in kobe's state.json, which the daemon cannot read) and sends both.
 *
 * Spec + handler live together (the PANE_VERB pattern) rather than the spec
 * sitting in a `verbs-*.ts` group: these two read the engine preset registry,
 * so keeping the flag list next to the code that consumes it is what stops the
 * documented values and the accepted values drifting apart. `verbs.ts` imports
 * the finished specs.
 */

import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { installedEngineIds } from "../../engine/account-detect.ts"
import {
  GENERIC_PROTOCOL,
  describePreset,
  listEnginePresets,
  resolveCommandProtocol,
  sessionProtocol,
} from "../../engine/engine-presets.ts"
import { ensurePluginEnginesLoaded } from "../../engine/plugin-engines.ts"
import { engineEntry } from "../../engine/registry.ts"
import { type VendorId, coerceVendorId } from "../../types/vendor.ts"
import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

/**
 * The same engines the TUI's pickers offer: `listEnginePresets()` (built-ins +
 * registered custom presets) widened with everything else
 * `installedEngineIds()` finds — the shipped contrib engines whose binary is
 * on PATH, and every plugin-contributed engine. One list, so `engine-list` and
 * Settings → Engines cannot disagree about what Rove can launch; a contrib
 * engine `engine-list` could not name was dispatched as `generic` and lost its
 * activity badges.
 */
async function listAllEnginePresets() {
  // Plugin-contributed engines are loaded from enabled plugin manifests at
  // process start in the TUI, but the CLI path must load them explicitly.
  ensurePluginEnginesLoaded()
  const presets = [...listEnginePresets()]
  const seen = new Set(presets.map((p) => p.id))
  for (const id of await installedEngineIds()) {
    if (!seen.has(id)) presets.push(describePreset(id))
  }
  return presets
}

export const ENGINE_LIST_VERB: VerbSpec = {
  name: "engine-list",
  group: "discover",
  summary:
    "List every engine Rove can launch — built-ins, registered presets, the shipped contrib engines whose CLI is on PATH (gemini, opencode, cursor, grok, droid, amp), and engines contributed by enabled plugins — each with its RAW launch command, exactly as it runs. Copy one into `add --command` / `send --tab new --command` verbatim, or edit its flags first. `protocol` is the adapter Rove speaks to it (history, trust, delivery); `generic` = none, which still runs fine but loses transcript reads. Returns { engines }.",
  flags: [],
  // Presets live in state.json + plugin manifests, not the daemon — no RPC, no daemon needed.
  offline: true,
  handler: async () => ({ engines: await listAllEnginePresets() }),
}

async function setCommand(ctx: VerbContext): Promise<unknown> {
  const command = ctx.args.require("command")
  // The protocol is DERIVED, never declared: this is the same resolution
  // `add --command` runs, so a task's recorded protocol matches what the
  // dispatch face would have picked for the same string. An unrecognisable
  // command records the generic protocol rather than keeping a stale one
  // from a different engine — a wrong protocol points the history reader
  // and trust store at another vendor's files.
  const vendor = resolveCommandProtocol(command)
  await simpleRpc(ctx, "task.setCommand", {
    taskId: ctx.args.require("task-id"),
    command,
    vendor,
  })
  return { ok: true, command, protocol: vendor, ...(vendor === GENERIC_PROTOCOL ? { generic: true } : {}) }
}

export const SET_COMMAND_VERB: VerbSpec = {
  name: "set-command",
  group: "edit",
  summary:
    "Set a task's engine launch command (takes effect on the next session rebuild). The protocol Rove speaks to it is derived from the command — the result reports which one, `generic` when the command names no engine Rove knows.",
  flags: [F.taskId(), { ...F.command(), required: true }],
  handler: setCommand,
}

/**
 * The engine whose effort levels govern a task: its PINNED command when it
 * has one, else its `vendor`'s PROTOCOL — the same resolution
 * `engineLaunchArgv` performs, so the level this verb accepts is the level
 * the launch actually carries.
 *
 * `sessionProtocol`, not the raw `vendor`: a task created from the TUI's
 * new-task dialog records the picked engine id in `vendor` with no `command`
 * (`tui/lib/task-create-flow.ts`), so a `mycodex` preset declaring the codex
 * protocol arrived here as `mycodex`, found the registry's empty custom entry,
 * and had every level rejected — `set-effort` could not set one at all on the
 * tasks most likely to want one. A built-in id resolves to itself.
 */
function taskEngine(task: Pick<SerializedTask, "command" | "vendor">): VendorId {
  const command = task.command?.trim()
  if (command) {
    const resolved = resolveCommandProtocol(command)
    if (resolved !== GENERIC_PROTOCOL) return resolved
  }
  return sessionProtocol(coerceVendorId(task.vendor))
}

/**
 * Reject `level` unless `engine` declares it. Exported because `add --effort`
 * must refuse exactly what `set-effort` refuses — one gate, two entry points,
 * so a level accepted at create time cannot be one `set-effort` would have
 * rejected.
 *
 * Validated HERE rather than passed through: `withEngineEffort` drops a level
 * the engine never declared, silently — which is how a user picks "high" and
 * gets the default with no error anywhere.
 *
 * `recover` is the argv the error's `nextCommandArgs` offers: `get-task` when
 * the task already exists, `engine-list` when it does not yet.
 */
export function assertEngineAcceptsEffort(engine: VendorId, level: string, recover: readonly string[]): void {
  const levels = engineEntry(engine).effortLevels ?? []
  if (levels.length === 0) {
    throw new ApiError(`engine ${engine} declares no reasoning effort levels`, "BAD_EFFORT", {
      engine,
      hint: `Only engines with declared levels accept one (codex today). Check the task's engine with \`get-task\`.`,
      nextCommandArgs: [...recover],
    })
  }
  if (!levels.includes(level)) {
    throw new ApiError(
      `engine ${engine} does not accept effort level ${JSON.stringify(level)} — it declares ${levels.join(", ")}`,
      "BAD_EFFORT",
      {
        engine,
        levels,
        hint: `Pass one of: ${levels.join(", ")}.`,
        nextCommandArgs: [...recover],
      },
    )
  }
}

async function setEffort(ctx: VerbContext): Promise<unknown> {
  const taskId = ctx.args.require("task-id")
  const level = ctx.args.require("level").trim()
  const daemon = daemonOf(ctx)
  const { task } = await daemon.request<{ task: SerializedTask }>("task.get", { taskId })
  const engine = taskEngine(task)
  assertEngineAcceptsEffort(engine, level, ["api", "get-task", "--task-id", taskId])
  // Which vendor to write back. `taskEngine` resolved the PROTOCOL — the right
  // thing to validate a level against, and the wrong thing to persist when the
  // record already spells that protocol as a preset id: a `mycodex` task
  // silently became `codex`, so the footer stopped rendering the user's
  // `engineName.mycodex` label. Launch never depended on the write
  // (`engineLaunchArgv` prefers the pinned command), so the label was the only
  // casualty.
  //
  // A record whose vendor does NOT resolve to the engine is a different case:
  // that is a stale or generic vendor next to a command naming a real one, and
  // naming it is a genuine upgrade (the same one `resolveProtocolUpgrade`
  // performs). So: keep the id when it already means this engine, correct it
  // when it does not.
  const recorded = coerceVendorId(task.vendor)
  const vendor = sessionProtocol(recorded) === engine ? recorded : engine
  await simpleRpc(ctx, "task.setVendor", { taskId, vendor, effort: level })
  return { ok: true, taskId, engine, effort: level }
}

export const SET_EFFORT_VERB: VerbSpec = {
  name: "set-effort",
  group: "edit",
  summary:
    "Set a task's reasoning effort level (takes effect on the next session rebuild). Rejected when the task's engine declares no levels, or does not declare THIS one — the error names the levels it does accept. Codex accepts none/low/medium/high/xhigh/max; claude has none.",
  flags: [
    F.taskId(),
    // Deliberately not an enum: levels are declared PER ENGINE (registry
    // `effortLevels`), including by plugin engines this static list cannot
    // see — the same open-set reasoning as `F.vendor()`. The handler checks
    // against the task's own engine, which is the only authoritative list.
    {
      name: "level",
      type: "string",
      required: true,
      placeholder: "LEVEL",
      description: "Effort level the task's engine declares (codex: none, low, medium, high, xhigh, max).",
    },
  ],
  handler: setEffort,
}
