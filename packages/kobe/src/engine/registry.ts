/**
 * Engine registry: the one place per-vendor wiring lives. Neutral layers
 * (monitor, orchestrator, TUI) call {@link engineEntry} with the task's
 * `vendor` instead of hard-coding vendor strings or if-ladders. Adding an
 * engine = one entry here plus its vendor-local modules.
 *
 * Custom (user-registered) engines get {@link customEngineEntry}: an explicit
 * EMPTY entry (no transcript store, so auto-title never mis-reads another
 * vendor's files; no account detection; no hooks) whose `defaultCommand` is
 * the bare id; the real launch command lives in `engineCommand.<id>`
 * (`interactive-command.ts`).
 *
 * Must stay importable from vitest and MUST NOT import from `src/tui/`.
 */

import type { EngineCapabilities, EngineIdentity, EngineQuotaUsage, EngineUsageSnapshot, Message } from "@/types/engine"
import { BUILTIN_VENDORS, type VendorId, isBuiltinVendor } from "@/types/vendor"
import type {
  ClaudeAccount,
  CodexAccount,
  CopilotAccount,
  DetectDeps,
  EngineAccountStatus,
  KimiAccount,
} from "./account-detect.ts"
import type { EngineTurnReader } from "./agent-turn.ts"
import { BUILTIN_ENGINES } from "./builtin-engines.ts"
import { CONTRIB_ENGINE_IDS, contribEngineEntry, isContribEngine, pluginEngineIds } from "./contrib-engines.ts"
import { EMPTY_HISTORY } from "./history-readers.ts"
import { type EngineHookAdapter, NoopHookAdapter } from "./hook-adapter.ts"
import type { EngineScreenManifest } from "./screen-state.ts"
import type { EngineSessionIdentity } from "./session-identity.ts"
import {
  type EngineTerminalTitle,
  stripStatusPrefix,
  titleIsPlaceholder,
  titleSessionId,
  titleTurnHint,
} from "./terminal-title.ts"
import type { EngineTurnDetector } from "./turn-detector.ts"
import { UnknownTurnDetector } from "./turn-detector.ts"

/**
 * Neutral reader over an engine's transcript store (claude's per-worktree
 * `~/.claude/projects/*`, codex's global `~/.codex/sessions/**`, copilot's
 * `~/.copilot/session-state`).
 */
export interface EngineHistoryReader {
  /** Session ids for `worktree`, OLDEST-FIRST (auto-title depends on it); `[]` when none. Never throws. */
  listSessionIdsForWorktree(worktree: string): Promise<readonly string[]>
  /** Neutral messages for one session id; `[]` when not found. */
  readHistory(sessionId: string): Promise<readonly Message[]>
  /**
   * Session-aggregate usage. Vendor token math (what counts as context,
   * cached vs fresh) happens here, never in UI layers. Absent (kimi, custom)
   * means "not reported", distinct from a reported zero.
   */
  readUsageSnapshot?(sessionId: string): Promise<EngineUsageSnapshot | undefined>
  /**
   * Absolute transcript path, or null. Not for kobe to parse: the cross-engine
   * handoff gives it to the next agent in its native format. `worktree`
   * scopes stores keyed by directory (claude).
   */
  transcriptPath(sessionId: string, worktree: string): Promise<string | null>
  /** Newest transcript mtime (epoch ms) for `worktree`, 0 when none; drives the Ops "new activity" badge. Never throws. */
  latestTranscriptMtimeForWorktree(worktree: string): Promise<number>
}

/** One entry of an engine's model list — the id its `--model` flag takes. */
export interface EngineModel {
  readonly id: string
  /** Human label when the id is not one (omp's `name`); absent = show the id. */
  readonly label?: string
}

/** Any built-in engine's account shape (each union already has a `none` arm). */
type EngineAccount = ClaudeAccount | CodexAccount | CopilotAccount | KimiAccount

export interface EngineRegistryEntry {
  readonly vendor: VendorId
  /** True for the three first-party engines; false for user-added ids. */
  readonly builtin: boolean
  /** Built-in human label ("Claude"); a custom engine labels as its id. */
  readonly displayName: string
  /**
   * Built-in launch argv before any user `engineCommand.<id>` override.
   * Custom engines fall back to a bare binary named after the id.
   */
  readonly defaultCommand: readonly string[]
  /**
   * Effort levels, lowest→highest; undefined when there is no driveable flag
   * (claude picks at runtime; copilot/custom have none). Only lets the picker
   * offer them: without {@link effortArgv} a pick passes every gate and is
   * silently dropped at launch.
   */
  readonly effortLevels?: readonly string[]
  /**
   * Argv for reasoning `level` (already validated against
   * {@link effortLevels}). Full-argv rewrite because shapes differ in kind
   * (codex: `-c model_reasoning_effort=high`). Absent = a level is dropped,
   * not guessed. Always pair with {@link effortLevels}.
   */
  readonly effortArgv?: (base: readonly string[], level: string) => readonly string[]
  /**
   * Model suggestions for pickers; undefined = can't list (copilot, kimi,
   * custom). claude/codex return their documented aliases; pi/omp run their
   * list verb (`engine/model-lists.ts`). Never a closed set: gates check
   * {@link modelArgv}, since pi's `--model` is fuzzy and claude takes full ids.
   * May reject; callers degrade to free text, never hide the field.
   */
  readonly listModels?: () => Promise<readonly EngineModel[]>
  /** Argv that pins `model`. Absent = a pinned model is refused at the gate (`BAD_MODEL`), not lost at spawn. */
  readonly modelArgv?: (base: readonly string[], model: string) => readonly string[]
  /** Transcript store reader. Empty (not claude's!) for custom engines. */
  readonly history: EngineHistoryReader
  /**
   * Read-only binary + login probe (Settings → Accounts); `deps` injects
   * fs/env (`account-detect.ts`). Absent = `account: null` in
   * `engine-status.ts`, "not detectable". Never stub `{ kind: "none" }`: that
   * means "found no login" and marks the engine unusable.
   */
  readonly detectAccount?: (deps?: DetectDeps) => Promise<EngineAccountStatus<EngineAccount>>
  /** Activity-hook adapter — a no-op adapter for engines without wired hooks. */
  readonly createHookAdapter: () => EngineHookAdapter
  /** Turn-completion detector (`turn-detector.ts`); copilot/custom get {@link UnknownTurnDetector}. */
  readonly createTurnDetector: () => EngineTurnDetector
  /** Undefined for engines that declare none (copilot, custom). */
  readonly capabilities?: EngineCapabilities
  /** Product identity (composer placeholder etc.). Paired with capabilities. */
  readonly identity?: EngineIdentity
  /** OSC 0/2 title policy; shape and rules in `terminal-title.ts`. */
  readonly terminalTitle?: EngineTerminalTitle
  /** Session pin/resume/fork verbs (`session-identity.ts`). Absent = none known. */
  readonly sessionIdentity?: EngineSessionIdentity
  /**
   * Account usage windows, or null when unknowable; drives rate-limit
   * auto-resume and the Settings usage view. Hits the vendor's rate-limited
   * API: the daemon's usage cache owns cadence; never call per-render/event.
   */
  readonly quotaUsage?: () => Promise<EngineQuotaUsage | null>
  /**
   * How a session's first message (`--prompt`, init-prompt) reaches the engine:
   *   - "argv" (default): a positional arg (claude/codex).
   *   - "paste": the positional slot is a subcommand (kimi exits
   *     `Unknown command`), so spawn bare and paste once the process is up
   *     (`pastePromptWhenEngineUp`, `hosted-session.ts`).
   * Custom engines keep "argv"; `kimi -p` style wrappers use that slot.
   */
  readonly firstMessageDelivery?: "argv" | "paste"
  /**
   * Extra `ps` basenames beyond `defaultCommand[0]`, for binaries that rewrite
   * argv[0] (kimi's launcher becomes `kimi-co`). Without them the foreground
   * walk (`engine/foreground.ts`) sees a plain shell and delivery refuses
   * with ENGINE_NOT_RUNNING.
   */
  readonly processNames?: readonly string[]
  /**
   * Pre-trust a worktree in the vendor's trust store before a hosted spawn,
   * so the pane doesn't stall on a trust dialog. Idempotent and
   * merge-preserving. Absent = no gate kobe can pre-answer.
   */
  readonly trustWorktree?: (worktreePath: string) => void
  /** Completed {@link AgentTurn}s from one session transcript. Absent = no per-turn data; nothing is guessed. */
  readonly readTurns?: EngineTurnReader
  /**
   * Screen-state rules (`engine/screen-state.ts`) so the quiescence poll
   * classifies captures as working/blocked/idle, not "unknown". Bottom of the
   * ladder hooks > transcript markers > screen (precedence:
   * `turn-state-merge.ts`); for engines with no hooks (contrib) or gaps
   * (copilot's `NoopHookAdapter`).
   *
   * Claude and codex declare none: their hooks cover every state, including
   * the permission prompt (Claude fires `Notification/permission_prompt` →
   * `awaiting-input` → `permission_needed`, measured landing ~10s into the
   * turn while the dialog is up), and `mergeTurnStates` is hook-wins per tab,
   * so a screen rule would never be consulted.
   */
  readonly screenManifest?: EngineScreenManifest
}

// Re-exported so `@/engine/registry` stays the one import site.
export { EMPTY_HISTORY }

/** See module doc: the explicit empty entry for a user-registered engine id. */
function customEngineEntry(vendor: VendorId): EngineRegistryEntry {
  return {
    vendor,
    builtin: false,
    displayName: vendor,
    defaultCommand: [vendor],
    history: EMPTY_HISTORY,
    // No `detectAccount`: absent spells "no detector"; `contribEngineEntry` inherits it.
    createHookAdapter: () => new NoopHookAdapter(vendor),
    createTurnDetector: () => new UnknownTurnDetector(vendor),
  }
}

/**
 * Built-ins return their singleton; any other id a fresh
 * {@link customEngineEntry}. This module never reads `customEngineIds`, so it
 * stays state-free.
 */
export function engineEntry(vendor: VendorId): EngineRegistryEntry {
  if (isBuiltinVendor(vendor)) return BUILTIN_ENGINES[vendor]
  const custom = customEngineEntry(vendor)
  // Contrib engines: the empty entry overlaid with catalog identity + screen manifest.
  return isContribEngine(vendor) ? contribEngineEntry(vendor, custom) : custom
}

/**
 * Ids whose launch binary is nameable without state: built-ins, contrib, and
 * this run's plugins. Custom ids keep theirs in `engineCommand.<id>`, so
 * callers pass it in (`foreground.ts#engineProcessIn`'s `extraLaunch`). Not
 * cached: `pluginEngineIds()` changes as plugins toggle at runtime.
 */
export function identifiableEngineIds(): readonly VendorId[] {
  return [...BUILTIN_VENDORS, ...CONTRIB_ENGINE_IDS, ...pluginEngineIds()]
}

/**
 * True when `readHistory` is not {@link EMPTY_HISTORY}'s, so callers can tell
 * "no reader" (`engine_unsupported`) from "no sessions". Compares that one
 * method because kimi's reader resolves ids and paths but parses no messages.
 */
export function supportsStructuredHistory(vendor: VendorId): boolean {
  return engineEntry(vendor).history.readHistory !== EMPTY_HISTORY.readHistory
}

/** Union of every built-in's status glyphs; fallback for vendors declaring none. */
const ALL_STATUS_PREFIXES: readonly string[] = [
  ...new Set(Object.values(BUILTIN_ENGINES).flatMap((entry) => entry.terminalTitle?.statusPrefixes ?? [])),
]

/** The vendor's own status glyphs, else the built-in union. */
export function engineStatusPrefixes(vendor: VendorId): readonly string[] {
  const declared = engineEntry(vendor).terminalTitle?.statusPrefixes
  return declared && declared.length > 0 ? declared : ALL_STATUS_PREFIXES
}

/**
 * Strip status decoration ({@link stripStatusPrefix}). `vendor` narrows the
 * vocabulary, never gates the strip: unknown (a wrapper like `claudecpa`, or
 * the ~2s `ps` probe not answered yet) uses the built-in union, else a raw
 * `✳ …` gets recorded. Safe because nothing writes a leading `⠹` it wants kept.
 */
export function stripEngineStatusPrefix(title: string, vendor: VendorId | null | undefined): string {
  return stripStatusPrefix(title, vendor ? engineStatusPrefixes(vendor) : ALL_STATUS_PREFIXES)
}

/** Turn state from the live title ({@link titleTurnHint}). */
export function engineTitleTurnHint(vendor: VendorId, title: string): "working" | "rest" | null {
  return titleTurnHint(engineEntry(vendor).terminalTitle, title)
}

/**
 * Session id the title is, or null. Requires a resolved vendor (as does
 * {@link isEnginePlaceholderTitle}): the id only means something in the
 * writing engine's store. See {@link EngineTerminalTitle.sessionIdFromTitle}.
 */
export function engineSessionIdFromTitle(vendor: VendorId, title: string): string | null {
  return titleSessionId(engineEntry(vendor).terminalTitle, title)
}

/** True when the title is a placeholder (codex's thread UUID); render the first-prompt summary, then the vendor default. */
export function isEnginePlaceholderTitle(title: string, vendor: VendorId): boolean {
  return titleIsPlaceholder(engineEntry(vendor).terminalTitle, title)
}

/** Undefined for copilot/custom; callers must not borrow another vendor's policy. */
export function getCapabilities(vendor: VendorId): EngineCapabilities | undefined {
  return engineEntry(vendor).capabilities
}

/**
 * Built-ins with a quota probe. Quota is account-level, so the usage poller
 * uses this list, not the vendors of open tasks. A probe that can't read a
 * login never publishes a snapshot.
 */
export function vendorsWithQuotaProbe(): readonly VendorId[] {
  return Object.values(BUILTIN_ENGINES)
    .filter((entry) => entry.quotaUsage)
    .map((entry) => entry.vendor)
}

/** Built-ins with a per-turn reader; `agent-turns` names them so an empty page can say why it is empty. */
export function vendorsWithTurnReader(): readonly VendorId[] {
  return Object.values(BUILTIN_ENGINES)
    .filter((entry) => entry.readTurns)
    .map((entry) => entry.vendor)
}
