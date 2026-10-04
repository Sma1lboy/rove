/**
 * Engine PRESETS and the command → protocol resolution behind them.
 *
 * Dispatch (`rove api add` / `send --tab new`) takes a raw `--command`, never
 * a vendor; the protocol kobe speaks to it (history reader, trust store,
 * whether the first message may ride argv) is DERIVED from that command.
 *
 * Resolution is three-tiered — this module owns tier (a), the deterministic one:
 *   a) `argv[0]` names a built-in binary or a registered preset ⇒ that
 *      preset's protocol. The main path, and the only one that answers
 *      before the process exists.
 *   b) post-launch sniffing (`./protocol-sniff.ts`) upgrades a session
 *      that tier (a) could not name.
 *   c) neither answers ⇒ {@link GENERIC_PROTOCOL}, which resolves to the
 *      registry's empty custom entry: no transcript reader, no hooks,
 *      silence-window liveness and settle-paste delivery.
 *
 * A CUSTOM engine is a NAMED PRESET: an id in `customEngineIds`, its command
 * in `engineCommand.<id>`, display name in `engineName.<id>`, and protocol in
 * `engineProtocol.<id>` (declared once so dispatch is deterministic, not
 * re-sniffed; unset reads as generic).
 *
 * Reads state, so NOT in `registry.ts` (kept state-free for vitest and the daemon).
 */

import { randomUUID } from "node:crypto"
import { type EngineRegistryEntry, engineEntry } from "@/engine/registry"
import { getCustomEngineIds, getPersistedString } from "@/state/repos"
import { BUILTIN_VENDORS, type VendorId, isBuiltinVendor } from "@/types/vendor"
import { isContribEngine } from "./contrib-engines.ts"
import { vendorFromArgv } from "./foreground.ts"
import {
  defaultEngineCommand,
  engineCommandKey,
  engineDisplayName,
  interactiveEngineCommand,
  parseEngineCommand,
  withEngineEffort,
  withEngineModel,
  withEngineTerminalTitle,
} from "./interactive-command.ts"
import {
  acceptsPinnedSession,
  acceptsSessionFork,
  forkSessionArgvFor,
  pinSessionArgv,
  resumeSessionArgv,
} from "./session-identity.ts"

/**
 * The protocol id for "kobe cannot name this engine". Deliberately not a
 * built-in vendor: {@link engineEntry} answers any unknown id with its
 * documented EMPTY entry, so the degraded path needs no branch of its own.
 */
export const GENERIC_PROTOCOL = "generic" as const

/** Protocols a preset may declare: the built-in adapters ({@link BUILTIN_VENDORS}). */
export const ENGINE_PROTOCOLS: readonly VendorId[] = BUILTIN_VENDORS

/** state.json key holding a custom preset's declared protocol. */
export function engineProtocolKey(id: string): string {
  return `engineProtocol.${id}`
}

/**
 * A preset's declared protocol, or undefined. Built-ins and contrib engines ARE
 * their own protocol: their registry entry (e.g. a contrib screen manifest)
 * already holds what a protocol names.
 */
export function getEngineProtocol(id: string): VendorId | undefined {
  if (isBuiltinVendor(id) || isContribEngine(id)) return id
  const raw = getPersistedString(engineProtocolKey(id))?.trim()
  return raw && ENGINE_PROTOCOLS.includes(raw) ? raw : undefined
}

/** True when `id` names an engine kobe can launch by NAME alone. */
function isPresetId(id: string): boolean {
  return isBuiltinVendor(id) || isContribEngine(id) || getCustomEngineIds().includes(id)
}

/** Every registered engine id, built-ins first. */
export function listPresetIds(): readonly string[] {
  return [...BUILTIN_VENDORS, ...getCustomEngineIds()]
}

/** One row of the `engine-list` verb — what the preset launches, verbatim. */
export interface EnginePreset {
  readonly id: string
  readonly name: string
  /** The exact command line this preset launches. What you see is what runs. */
  readonly command: string
  /** The adapter kobe speaks to it with; `generic` = no adapter knowledge. */
  readonly protocol: VendorId
  readonly builtin: boolean
}

export function describePreset(id: string): EnginePreset {
  const override = getPersistedString(engineCommandKey(id))?.trim()
  const command = override || defaultEngineCommand(id).join(" ")
  return {
    id,
    name: engineDisplayName(id),
    command,
    protocol: getEngineProtocol(id) ?? GENERIC_PROTOCOL,
    builtin: isBuiltinVendor(id),
  }
}

/** Every engine entry, built-in and custom, with its raw launch command. */
export function listEnginePresets(): readonly EnginePreset[] {
  return listPresetIds().map(describePreset)
}

/**
 * Tier (a): the protocol a raw launch command speaks, or
 * {@link GENERIC_PROTOCOL} when nothing in it is recognisable.
 *
 * Order matters: (1) a bare preset id, so `--command my-aider` means the
 * registered preset, not a same-named binary; (2) the argv walk the
 * process-tree probe uses, so wrappers (`env FOO=1 claude`, `node …/codex.js`)
 * and renames (kimi → `kimi-co`) resolve as at runtime; (3) a preset whose OWN
 * command starts with this binary, so a hand-typed preset command gets its
 * declared protocol.
 */
export function resolveCommandProtocol(command: string | undefined): VendorId {
  const trimmed = command?.trim()
  if (!trimmed) return GENERIC_PROTOCOL
  if (isPresetId(trimmed)) return getEngineProtocol(trimmed) ?? GENERIC_PROTOCOL
  const fromArgv = vendorFromArgv(trimmed)
  if (fromArgv) return fromArgv
  const argv0 = parseEngineCommand(trimmed)[0]
  if (argv0) {
    for (const id of getCustomEngineIds()) {
      const preset = getPersistedString(engineCommandKey(id))?.trim()
      if (preset && parseEngineCommand(preset)[0] === argv0) return getEngineProtocol(id) ?? GENERIC_PROTOCOL
    }
  }
  return GENERIC_PROTOCOL
}

/** What to launch for a task/tab: its pinned command, else its protocol's preset. */
export interface EngineLaunchSpec {
  /** Raw `--command` pinned on the task or tab; wins over `vendor`. */
  readonly command?: string
  /** Resolved protocol (or a preset id, on records that predate `command`). */
  readonly vendor?: VendorId
  readonly effort?: string
  /** Pinned model id/alias/pattern; the protocol's `modelArgv` carries it. */
  readonly model?: string
}

/**
 * Launch argv for a task or tab.
 *
 * For a custom preset two rules pull apart:
 *   - the BASE command comes from the preset id, so `--command claude` honors
 *     the `engineCommand.claude` override from Settings;
 *   - vendor launch FLAGS (codex effort + terminal-title) come from the
 *     resolved PROTOCOL — keying off the id finds the empty custom entry and
 *     silently drops them.
 * A built-in id resolves to itself, so both agree there.
 */
export function engineLaunchArgv(spec: EngineLaunchSpec): readonly string[] {
  const command = spec.command?.trim()
  if (!command) return interactiveEngineCommand(spec.vendor, spec.effort, spec.model)
  const vendor = (isPresetId(command) ? getEngineProtocol(command) : undefined) ?? resolveCommandProtocol(command)
  const base = isPresetId(command)
    ? presetBaseArgv(command)
    : (() => {
        const argv = parseEngineCommand(command)
        return argv.length > 0 ? argv : null
      })()
  if (!base) return interactiveEngineCommand(spec.vendor, spec.effort, spec.model)
  return withEngineTerminalTitle(
    withEngineModel(withEngineEffort(base, vendor, spec.effort), vendor, spec.model),
    vendor,
  )
}

/** A preset's UNDECORATED launch argv: its command override, else its default. */
function presetBaseArgv(id: string): readonly string[] | null {
  const override = getPersistedString(engineCommandKey(id))?.trim()
  if (override) {
    const argv = parseEngineCommand(override)
    if (argv.length > 0) return argv
  }
  return defaultEngineCommand(id)
}

/**
 * The engine whose SESSION VERBS apply to a launch of `id` — its declared
 * protocol when it is a custom preset, else the id itself. A `claudecpa` preset
 * declaring claude takes claude's `--session-id` / `--resume`; keying off the id
 * would find the empty custom entry and lose the conversation on restart.
 */
export function sessionProtocol(vendor: VendorId | undefined): VendorId {
  const id = vendor?.trim()
  if (!id) return "claude"
  return getEngineProtocol(id) ?? id
}

/**
 * The registry entry whose PROTOCOL behaviour applies to `vendor` — its
 * declared `engineProtocol.<id>` when it is a custom preset, else its own.
 *
 * `engineEntry(vendor)` answers "what IS this engine" (name, default command)
 * and stays keyed on the raw id. This answers "how do we TALK to it": transcript
 * reader, trust store, first-message delivery (`docs/ENGINES.md`). The raw id
 * would give the empty custom entry — no history, an unanswered trust dialog,
 * and argv delivery that kills a kimi-protocol launch.
 */
export function protocolEntry(vendor: VendorId | undefined): EngineRegistryEntry {
  return engineEntry(sessionProtocol(vendor))
}

/**
 * Argv that PINS a fresh session id, plus the id itself — or
 * `{ argv, sessionId: null }` when this engine mints its own id
 * (codex/kimi/custom) or the command already controls its session.
 * `newId` is a seam for the tab path, which re-pins an id it already holds.
 */
export function withPinnedSessionId(
  argv: readonly string[],
  vendor: VendorId | undefined,
  newId: () => string = randomUUID,
): { argv: readonly string[]; sessionId: string | null } {
  const identity = engineEntry(sessionProtocol(vendor)).sessionIdentity
  if (!acceptsPinnedSession(identity, argv)) return { argv, sessionId: null }
  const sessionId = newId()
  return { argv: pinSessionArgv(identity, argv, sessionId), sessionId }
}

/**
 * Argv that RESUMES `sessionId`, or null when the engine declares no resume
 * verb / the command already controls its own session. The caller then
 * launches the bare command — a fresh conversation, honestly, rather than a
 * flag that would kill the launch (kimi exits on claude's `--resume`).
 */
export function engineResumeArgv(
  base: readonly string[],
  vendor: VendorId | undefined,
  sessionId: string,
): readonly string[] | null {
  return resumeSessionArgv(engineEntry(sessionProtocol(vendor)).sessionIdentity, base, sessionId)
}

/**
 * True when this engine can BRANCH a conversation — declared by the adapter
 * (`EngineSessionIdentity.forkArgv`), not listed here. The bar is a verb that
 * LAUNCHES the branched session, since this argv becomes a tab's command.
 * Claude and codex clear it. Copilot's `--resume` only REOPENs (two live
 * processes on one transcript). Kimi 0.40.1's `fork [sessionId]` prints
 * `Forked to session_<new-id> … in <n>ms` and EXITS, so the pane would die on
 * the first frame; fork-then-`-S <new-id>` is two launches, outside this contract.
 *
 * Protocol-resolved like {@link withPinnedSessionId}, so a claude-protocol
 * preset forks.
 */
export function engineCanFork(vendor: VendorId | undefined): boolean {
  return acceptsSessionFork(engineEntry(sessionProtocol(vendor)).sessionIdentity)
}

/**
 * Argv that FORKS `sourceId` into a new diverging session, or null when the
 * engine has no fork verb, there is no source id, or the command already
 * controls its own session. The caller then opens an ordinary tab.
 */
export function engineForkArgv(
  base: readonly string[],
  vendor: VendorId | undefined,
  sourceId: string,
  newId?: string | null,
): readonly string[] | null {
  return forkSessionArgvFor(engineEntry(sessionProtocol(vendor)).sessionIdentity, base, sourceId, newId)
}
