/**
 * Engine registry — the ONE place per-vendor wiring lives.
 *
 * CLAUDE.md "Engine-owned UI data": neutral layers (monitor, orchestrator,
 * TUI) must not hard-code vendor strings or pick vendor-specific readers
 * with inline if-ladders. Instead they call {@link engineEntry} with the
 * task's `vendor` and use whatever the entry exposes:
 *
 *   - `history`        — transcript store reader (auto-title, recap).
 *   - `detectAccount`  — read-only login/binary probe (Settings → Accounts).
 *   - `createHookAdapter` — activity-hook installer (claude + codex today).
 *   - `createTurnDetector` — Terminal Tab turn-completion detection.
 *   - `defaultCommand` / `displayName` — launch + label defaults.
 *
 * Adding an engine = one new entry here (plus its vendor-local modules);
 * removing the vendor if-ladders from neutral code was the point (KOB).
 *
 * Custom (user-registered) engines get {@link customEngineEntry}: an
 * explicit, documented EMPTY entry — no transcript store (auto-title keeps
 * the placeholder rather than mis-reading another vendor's files), no
 * account detection, no hooks, and a `defaultCommand` of the
 * bare id (the real launch command lives in the user's
 * `engineCommand.<id>` override; see `interactive-command.ts`). This
 * preserves the pre-registry behavior for unknown vendor ids exactly.
 *
 * Must stay importable from vitest and MUST NOT import from `src/tui/`.
 */

import type { EngineCapabilities, EngineIdentity, EngineQuotaUsage, Message } from "@/types/engine"
import { type VendorId, isBuiltinVendor } from "@/types/vendor"
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
import { contribEngineEntry, isContribEngine } from "./contrib-engines.ts"
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
 * Reader over an engine's on-disk transcript store, in the neutral shape
 * auto-title (and future recap) consumes. Vendor formats stay behind it:
 * claude's per-worktree `~/.claude/projects/*` dirs, codex's global
 * `~/.codex/sessions/**` rollouts, copilot's `~/.copilot/session-state`.
 */
export interface EngineHistoryReader {
  /**
   * Session ids recorded for `worktree`, OLDEST-FIRST (the task's origin
   * conversation comes first — auto-title depends on this order). `[]`
   * when the worktree has no transcripts. Never throws.
   */
  listSessionIdsForWorktree(worktree: string): Promise<readonly string[]>
  /** Neutral messages for one session id; `[]` when not found. */
  readHistory(sessionId: string): Promise<Message[]>
  /**
   * Absolute path of the on-disk transcript for `sessionId`, or null when
   * the engine has no file to point at. Not for kobe to PARSE (that's
   * `readHistory`) — it is what the cross-engine handoff hands the next
   * agent to read itself, so its native format never has to be converted.
   * `worktree` scopes stores that key by directory (claude's project dir).
   */
  transcriptPath(sessionId: string, worktree: string): Promise<string | null>
  /**
   * Newest transcript mtime (epoch ms) for `worktree`, or 0 when the task
   * has no transcript yet. The Ops pane's activity poll watches this to
   * light its "new activity" badge. Never throws — readers are
   * best-effort and the poller treats 0 as "no activity seen".
   */
  latestTranscriptMtimeForWorktree(worktree: string): Promise<number>
}

/** Any built-in engine's account shape (each union already has a `none` arm). */
export type EngineAccount = ClaudeAccount | CodexAccount | CopilotAccount | KimiAccount

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
   * Reasoning/effort levels this engine accepts, lowest→highest. Codex maps
   * a selected level to `-c model_reasoning_effort=<level>` at launch (see
   * `interactive-command.ts`). Undefined for engines with no kobe-driveable
   * effort flag (claude picks reasoning at runtime; copilot/custom have none).
   */
  readonly effortLevels?: readonly string[]
  /** Transcript store reader. Empty (not claude's!) for custom engines. */
  readonly history: EngineHistoryReader
  /**
   * Read-only binary + login probe (Settings → Accounts). `deps` is the
   * injectable fs/env surface from `account-detect.ts`; omit for production.
   */
  readonly detectAccount: (deps?: DetectDeps) => Promise<EngineAccountStatus<EngineAccount>>
  /** Activity-hook adapter — a no-op adapter for engines without wired hooks. */
  readonly createHookAdapter: () => EngineHookAdapter
  /**
   * Turn-completion detector for Terminal Tab status (transcript markers +
   * pane quiescence; see `turn-detector.ts`). Engines without persisted
   * completion markers (copilot, custom) get an {@link UnknownTurnDetector}
   * whose `supportsCompletionMarkers()` is false.
   */
  readonly createTurnDetector: () => EngineTurnDetector
  /**
   * Model catalog + permission modes + identity (settings, pickers).
   * Undefined for engines without a kobe-known catalog (copilot, custom).
   */
  readonly capabilities?: EngineCapabilities
  /** Product identity (composer placeholder etc.). Paired with capabilities. */
  readonly identity?: EngineIdentity
  /**
   * Native OSC 0/2 title policy for interactive terminal sessions — status
   * vocabulary, the launch args that select the engine's own title fields,
   * and the rules for a title that isn't a name (see `terminal-title.ts`,
   * which owns the shape and every rule that reads it).
   */
  readonly terminalTitle?: EngineTerminalTitle
  /**
   * How this engine's CLI handles session identity — the flag that pins a
   * caller-set id, the flags that mean the command already controls its own
   * session, and the argv that resumes one (see `session-identity.ts`,
   * which owns the shape and every rule that reads it). Absent = Rove knows
   * no session verbs for this engine.
   */
  readonly sessionIdentity?: EngineSessionIdentity
  /**
   * Subscription-quota probe: snapshot of the account's usage windows, or
   * null when unknowable. Drives the daemon's rate-limit auto-resume
   * schedule and the Settings usage dashboard. The probe hits the vendor's
   * own rate-limited API — the daemon's usage cache owns the fetch cadence;
   * never call this per-render or per-event. Omit for engines without a
   * readable quota API.
   */
  readonly quotaUsage?: () => Promise<EngineQuotaUsage | null>
  /**
   * How a session's FIRST message (the `send --tab new --prompt` /
   * `add --prompt` / repo init-prompt text) may reach the engine:
   *   - "argv" (default): appended to the launch argv as a positional arg —
   *     claude/codex accept an initial prompt there.
   *   - "paste": the CLI's positional slot is a SUBCOMMAND, not a prompt
   *     (kimi exits `Unknown command` on one — issue #25), so the launch
   *     spawns bare and the spawner pastes the message once the engine
   *     process is up (`pastePromptWhenEngineUp` in `hosted-session.ts`).
   * Custom engines keep "argv" — their launch-command contract is the
   * user's own (`kimi -p` style wrappers RIDE the positional slot).
   */
  readonly firstMessageDelivery?: "argv" | "paste"
  /**
   * Extra executable basenames this engine's LIVE process may show as in
   * `ps`, beyond `defaultCommand[0]` — for binaries that rewrite their
   * process title post-launch (kimi's Mach-O launcher rewrites argv[0] to
   * `kimi-co`, verified on two live sessions 2026-08-15). The foreground
   * walk (`engine/foreground.ts`) matches these the same way it matches
   * the launch binary; without them a running engine reads as a plain
   * shell and prompt delivery refuses with ENGINE_NOT_RUNNING.
   */
  readonly processNames?: readonly string[]
  /**
   * Pre-trust a Rove-created worktree in the vendor's first-run trust
   * store (issue #28). Every vendor gates a never-seen directory behind a
   * modal trust dialog; hosted sessions can't answer one (kimi's even
   * EXITS when the pasted first message's Enter lands on "Don't trust").
   * Called before a hosted spawn; must be idempotent and merge-preserving.
   * Absent = the vendor has no gate kobe knows how to pre-answer.
   */
  readonly trustWorktree?: (worktreePath: string) => void
  /**
   * Per-turn telemetry reader (issue #32): completed {@link AgentTurn}s
   * lifted from ONE of this engine's session transcripts. Engine-owned by
   * construction — only the adapter knows where its vendor records the
   * model, timings, and token usage of a turn. Absent = this engine has no
   * per-turn attribution kobe can read (nothing is guessed for it).
   */
  readonly readTurns?: EngineTurnReader
  /**
   * Declarative screen-state rules for engines WITHOUT persisted completion
   * markers (see `engine/screen-state.ts`): the quiescence poll classifies
   * each pane capture into working/blocked/idle instead of "unknown".
   * Engines with markers don't declare one — the transcript is the better
   * authority, and hooks supersede both (`turn-state-merge.ts`).
   */
  readonly screenManifest?: EngineScreenManifest
}

// The per-vendor readers live in `history-readers.ts` (file-size cap);
// EMPTY_HISTORY is re-exported so `@/engine/registry` stays the one
// import site for the whole registry surface.
export { EMPTY_HISTORY }

/** See module doc: the explicit empty entry for a user-registered engine id. */
function customEngineEntry(vendor: VendorId): EngineRegistryEntry {
  return {
    vendor,
    builtin: false,
    displayName: vendor,
    defaultCommand: [vendor],
    history: EMPTY_HISTORY,
    detectAccount: async () => ({
      binary: { found: false, error: "custom engine: Rove has no account detector for it" },
      account: { kind: "none" },
    }),
    createHookAdapter: () => new NoopHookAdapter(vendor),
    createTurnDetector: () => new UnknownTurnDetector(vendor),
  }
}

/**
 * Resolve the registry entry for a vendor id. Built-ins return their
 * shared singleton entry; any other id returns a fresh
 * {@link customEngineEntry} (no registration step needed — a custom id is
 * "registered" by existing in the user's `customEngineIds` state, which
 * this module deliberately does not read so it stays state-free).
 */
export function engineEntry(vendor: VendorId): EngineRegistryEntry {
  if (isBuiltinVendor(vendor)) return BUILTIN_ENGINES[vendor]
  const custom = customEngineEntry(vendor)
  // Shipped contrib engines (data-only long tail): the custom empty entry
  // overlaid with the catalog's identity + screen manifest.
  return isContribEngine(vendor) ? contribEngineEntry(vendor, custom) : custom
}

/**
 * True when `vendor`'s adapter can turn a session into neutral MESSAGES —
 * i.e. its `readHistory` is not {@link EMPTY_HISTORY}'s. Neutral layers
 * (e.g. `kobe api read-output`) use this to label an `engine_unsupported`
 * fallback honestly instead of confusing "engine has no reader" with
 * "reader found no sessions". Compares that one method rather than the
 * whole object because kimi's reader is a partial: it resolves session
 * ids and transcript PATHS (enough for a cross-engine handoff) while
 * still shipping no message parser.
 */
export function supportsStructuredHistory(vendor: VendorId): boolean {
  return engineEntry(vendor).history.readHistory !== EMPTY_HISTORY.readHistory
}

/*
 * `vendorFromTerminalTitle` lived here (removed 2026-07-27). It matched a
 * live OSC title against each engine's product name / binary by substring,
 * which is how a shell tab where the user typed `claude` joined turn-status
 * management — and also how a claude session whose activity summary said
 * "codex" became a codex tab. Identity now comes from the process tree:
 * `engine/foreground.ts` + `tui/workspace/live-engine.ts`.
 */

/**
 * Every status glyph any built-in engine declares. The fallback vocabulary
 * for a vendor that declares none of its own — see
 * {@link stripEngineStatusPrefix}. Computed once; the built-in table is a
 * module constant.
 */
const ALL_STATUS_PREFIXES: readonly string[] = [
  ...new Set(Object.values(BUILTIN_ENGINES).flatMap((entry) => entry.terminalTitle?.statusPrefixes ?? [])),
]

/**
 * The status-glyph vocabulary to judge a vendor's title by: its own when it
 * declares one, else the union of every built-in's (see
 * {@link stripEngineStatusPrefix} for why the union is the right default).
 */
export function engineStatusPrefixes(vendor: VendorId): readonly string[] {
  const declared = engineEntry(vendor).terminalTitle?.statusPrefixes
  return declared && declared.length > 0 ? declared : ALL_STATUS_PREFIXES
}

/**
 * Strip the engine's own STATUS decoration from a live OSC title (rule:
 * {@link stripStatusPrefix}).
 *
 * `vendor` NARROWS the vocabulary; it never gates the strip. Anything
 * unknown — a custom wrapper (`claudecpa`, a zsh function that ends up
 * running the real claude), or simply a process-tree probe that has not
 * answered yet — falls back to the union of every built-in's glyphs. This is
 * the common case, not an edge: the probe is a ~2s `ps` walk, so gating on it
 * let a raw `✳ …` through on every tick it could not answer, and that title
 * is what gets RECORDED (owner report 2026-08-10: the prefix kept coming
 * back). The union is safe precisely because these glyphs are decoration in
 * any vendor's title — nothing writes a leading `⠹` it wants kept.
 */
export function stripEngineStatusPrefix(title: string, vendor: VendorId | null | undefined): string {
  return stripStatusPrefix(title, vendor ? engineStatusPrefixes(vendor) : ALL_STATUS_PREFIXES)
}

/**
 * What the engine's live OSC title says about its turn state (rule:
 * {@link titleTurnHint}) — how consumers (the TUI's interrupt observer, the
 * daemon's activity reconciler) read an interrupt without hard-coding any
 * vendor's glyphs.
 */
export function engineTitleTurnHint(vendor: VendorId, title: string): "working" | "rest" | null {
  return titleTurnHint(engineEntry(vendor).terminalTitle, title)
}

/**
 * The engine session id a live OSC title IS, or null when it is a name. Both
 * this and {@link isEnginePlaceholderTitle} take a RESOLVED vendor — unlike
 * {@link stripEngineStatusPrefix}, which falls back to every built-in's
 * glyphs, there is no safe guess here: the id is only meaningful read against
 * the store of the engine that wrote it. See
 * {@link EngineTerminalTitle.sessionIdFromTitle}.
 */
export function engineSessionIdFromTitle(vendor: VendorId, title: string): string | null {
  return titleSessionId(engineEntry(vendor).terminalTitle, title)
}

/**
 * True when a live OSC title is NOT a name — the engine's placeholder for
 * one it doesn't have yet (codex writes its thread UUID until the thread is
 * named). Surfaces render the next rung down instead: the tab's first-prompt
 * summary, then the vendor default.
 */
export function isEnginePlaceholderTitle(title: string, vendor: VendorId): boolean {
  return titleIsPlaceholder(engineEntry(vendor).terminalTitle, title)
}

/**
 * Capabilities for a vendor, or `undefined` when the engine has none (copilot,
 * custom). Consumed by the native chat composer's model picker +
 * permission-mode cycle; callers must handle the missing case rather than
 * borrow another vendor's catalog + permission modes.
 */
export function getCapabilities(vendor: VendorId): EngineCapabilities | undefined {
  return engineEntry(vendor).capabilities
}

/**
 * Built-in vendors that ship a quota probe. Quota is an ACCOUNT-level fact,
 * not a task-level one: a logged-in Codex account has a balance worth showing
 * whether or not any kobe task currently runs Codex. The daemon's usage poller
 * asks for this list rather than deriving vendors from the task list, which
 * silently hid every engine the user hadn't happened to open a task with.
 * Vendors whose probe can't read a login just never publish a snapshot.
 */
export function vendorsWithQuotaProbe(): readonly VendorId[] {
  return Object.values(BUILTIN_ENGINES)
    .filter((entry) => entry.quotaUsage)
    .map((entry) => entry.vendor)
}

/** Flat de-duped list of every model surfaced by every registered vendor. */
export function allModels(): readonly EngineCapabilities["models"][number][] {
  const seen = new Set<string>()
  const out: EngineCapabilities["models"][number][] = []
  for (const entry of Object.values(BUILTIN_ENGINES)) {
    if (!entry.capabilities) continue
    for (const m of entry.capabilities.models) {
      const key = `${m.vendor}:${m.id}:${m.effort ?? ""}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(m)
    }
  }
  return out
}
