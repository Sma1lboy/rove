/**
 * The engine face of `kobe api`: `engine-list` (what can I launch, and with
 * what command?), `set-command` (pin a task's launch command), `set-effort`
 * (pin its reasoning level) and `set-model` (pin its model).
 *
 * `engine-list` is WYSIWYG: it prints each raw command line so an agent can
 * copy one, edit a flag, and pass it back as `--command` without kobe
 * modelling anyone's flags. `set-command` resolves the protocol HERE (the
 * preset registry lives in state.json, which the daemon cannot read).
 *
 * Spec + handler live together so documented and accepted values can't drift.
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
import { type EngineModel, engineEntry } from "../../engine/registry.ts"
import { type VendorId, coerceVendorId } from "../../types/vendor.ts"
import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { ApiError, type VerbContext, type VerbSpec } from "./types.ts"

/**
 * The same engines the TUI's pickers offer: `listEnginePresets()` (built-ins +
 * registered custom presets) widened with everything else
 * `installedEngineIds()` finds (contrib engines on PATH, plugin engines). One
 * list, so `engine-list` and Settings → Engines cannot disagree; an unnamed
 * contrib engine would dispatch as `generic` and lose its activity badges.
 */
async function listAllEnginePresets() {
  const presets = await enginePresetsInList()
  // Keyed by PROTOCOL (`claudecpa` lists claude's aliases), listed once each
  // since pi/omp spawn a process. `null` = no list verb or it failed; `[]`
  // would mean "listed, found none".
  const byProtocol = new Map<string, Promise<readonly EngineModel[] | null>>()
  const modelsOf = (protocol: string) => {
    let pending = byProtocol.get(protocol)
    if (!pending) {
      const list = engineEntry(protocol).listModels
      pending = list ? list().catch(() => null) : Promise.resolve(null)
      byProtocol.set(protocol, pending)
    }
    return pending
  }
  return Promise.all(presets.map(async (preset) => ({ ...preset, models: await modelsOf(preset.protocol) })))
}

/** The presets `engine-list` prints, before their model lists are attached. */
async function enginePresetsInList() {
  // The TUI loads plugin engines at start; the CLI must load them explicitly.
  ensurePluginEnginesLoaded()
  const presets = [...listEnginePresets()]
  const seen = new Set(presets.map((p) => p.id))
  for (const id of await installedEngineIds()) {
    if (!seen.has(id)) presets.push(describePreset(id))
  }
  return presets
}

/** Every id `engine-list` names — the membership half of the auto-routing gate. */
export async function engineListIds(): Promise<readonly string[]> {
  return (await enginePresetsInList()).map((p) => p.id)
}

export const ENGINE_LIST_VERB: VerbSpec = {
  name: "engine-list",
  group: "discover",
  summary:
    "List every engine Rove can launch — built-ins, registered presets, the shipped contrib engines whose CLI is on PATH (gemini, opencode, cursor, grok, droid, amp, cline, kiro, maki, antigravity), and engines contributed by enabled plugins — each with its RAW launch command, exactly as it runs. Copy one into `add --command` / `send --tab new --command` verbatim, or edit its flags first. `protocol` is the adapter Rove speaks to it (history, trust, delivery); `generic` = none, which still runs fine but loses transcript reads. `models` is what the engine can name for `--model` (suggestions, not a closed set); null = Rove cannot list them for this engine. Returns { engines }.",
  flags: [],
  // Presets live in state.json + plugin manifests, not the daemon — no RPC, no daemon needed.
  offline: true,
  handler: async () => ({ engines: await listAllEnginePresets() }),
}

async function setCommand(ctx: VerbContext): Promise<unknown> {
  const command = ctx.args.require("command")
  // DERIVED, never declared — the same resolution `add --command` runs. An
  // unknown command records generic rather than keeping a stale protocol,
  // which would point the history reader and trust store at another vendor.
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
 * `sessionProtocol`, not the raw `vendor`: TUI-created tasks record the
 * preset id (e.g. `mycodex`) with no `command`, and the raw id finds an empty
 * registry entry that rejects every level. A built-in id resolves to itself.
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
 * Reject `level` unless `engine` declares it. One gate shared by
 * `add --effort` and `set-effort`. Validated HERE because `withEngineEffort`
 * silently drops an undeclared level (user picks "high", gets the default).
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

/**
 * Reject a model unless `engine` declares a flag to carry it. No closed-set
 * check on purpose: pi's `--model` is a fuzzy pattern and claude takes full
 * ids its alias list does not spell, so `listModels` is a suggestion source,
 * not a validator. Shared by `add --model` and `set-model`.
 */
export function assertEngineAcceptsModel(engine: VendorId, model: string, recover: readonly string[]): void {
  if (engineEntry(engine).modelArgv) return
  throw new ApiError(`engine ${engine} declares no model flag — it does not accept a model`, "BAD_MODEL", {
    engine,
    hint: "Only engines that declare a model flag accept one (claude, codex, kimi, pi, omp today); `engine-list` shows `models` per engine.",
    nextCommandArgs: [...recover],
  })
}

/** The vendor `set-effort`/`set-model` write back — see the comment in {@link setEffort}. */
function vendorToRecord(task: SerializedTask, engine: VendorId): VendorId {
  const recorded = coerceVendorId(task.vendor)
  return sessionProtocol(recorded) === engine ? recorded : engine
}

async function setModel(ctx: VerbContext): Promise<unknown> {
  const taskId = ctx.args.require("task-id")
  const model = ctx.args.require("model").trim()
  const daemon = daemonOf(ctx)
  const { task } = await daemon.request<{ task: SerializedTask }>("task.get", { taskId })
  const engine = taskEngine(task)
  assertEngineAcceptsModel(engine, model, ["api", "get-task", "--task-id", taskId])
  await simpleRpc(ctx, "task.setVendor", { taskId, vendor: vendorToRecord(task, engine), model })
  return { ok: true, taskId, engine, model }
}

export const SET_MODEL_VERB: VerbSpec = {
  name: "set-model",
  group: "edit",
  summary:
    "Pin a task's model (takes effect on the next session rebuild). Passed to the engine VERBATIM in its own spelling — claude alias or full id, codex slug, pi/omp pattern or `provider/id` — so `engine-list`'s `models` are suggestions, not a closed list. Rejected (BAD_MODEL) when the task's engine declares no model flag.",
  flags: [
    F.taskId(),
    {
      name: "model",
      type: "string",
      required: true,
      placeholder: "MODEL",
      description: "Model id/alias/pattern in the engine's own spelling; `engine-list` shows what each can name.",
    },
  ],
  handler: setModel,
}

async function setEffort(ctx: VerbContext): Promise<unknown> {
  const taskId = ctx.args.require("task-id")
  const level = ctx.args.require("level").trim()
  const daemon = daemonOf(ctx)
  const { task } = await daemon.request<{ task: SerializedTask }>("task.get", { taskId })
  const engine = taskEngine(task)
  assertEngineAcceptsEffort(engine, level, ["api", "get-task", "--task-id", taskId])
  // Validate against the PROTOCOL, but keep a preset id that already means it
  // (persisting `codex` over `mycodex` loses the footer's
  // `engineName.mycodex` label). A vendor that does NOT resolve to the engine
  // is stale/generic and gets corrected (as `resolveProtocolUpgrade` does).
  await simpleRpc(ctx, "task.setVendor", { taskId, vendor: vendorToRecord(task, engine), effort: level })
  return { ok: true, taskId, engine, effort: level }
}

export const SET_EFFORT_VERB: VerbSpec = {
  name: "set-effort",
  group: "edit",
  summary:
    "Set a task's reasoning effort level (takes effect on the next session rebuild). Rejected when the task's engine declares no levels, or does not declare THIS one — the error names the levels it does accept. Codex accepts none/low/medium/high/xhigh/max; claude has none.",
  flags: [
    F.taskId(),
    // Not an enum: levels are declared PER ENGINE (incl. plugin engines); the
    // handler checks against the task's own engine.
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
