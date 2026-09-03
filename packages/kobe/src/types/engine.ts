/**
 * Engine-derived data types (v0.6).
 *
 * v0.5 had a full `AIEngine` port (spawn/resume/stream/...) that the
 * orchestrator drove. Kobe now launches interactive engine CLIs through
 * Hosted PTYs and lets each engine own its conversation lifecycle. Engine
 * adapters expose history, identity, launch, capabilities, and telemetry.
 *
 * What lives here now:
 *   - `Message` / `EngineHistory` / `EngineUsageSnapshot` — the
 *     vendor-neutral shape that `engine/claude-code-local/history.ts`
 *     and `engine/codex-local/history.ts` normalize their on-disk
 *     JSONL into. Renderers downstream consume these, not the raw
 *     vendor records.
 *   - `ContentBlock` re-export — kept here as the canonical engine-type
 *     boundary; the actual taxonomy is owned by `types/content.ts`.
 *
 * What's gone (vs v0.5): `AIEngine`, `EngineEvent`, `SessionHandle`,
 * `SpawnOpts`, all UserInput / ApprovePlan / AskUserQuestion shapes,
 * `OrchestratorEvent`, command-discovery surfaces.
 * If a 0.6.x feature needs any of that, restore it deliberately —
 * don't drag the whole port back.
 *
 * Shared engine-capability types: `EngineCapabilities` / `EngineIdentity`,
 * consumed through the engine registry (engine-owned UI data, AGENTS.md).
 * The native composer's model picker + permission-mode cycle went with the
 * v0.6 port; their catalog members were retracted once nothing read them.
 */

import type { ContentBlock } from "./content"
import type { EngineTerminalPresentation } from "./terminal-presentation"
import type { VendorId } from "./vendor"
export type { ContentBlock } from "./content"

/**
 * One rolling quota window from an engine's subscription-usage probe,
 * already normalized to engine-neutral display facts. `kind` keeps the
 * vendor's raw window kind (e.g. `session` / `weekly_all` / `weekly_scoped`)
 * for policy decisions; `label` is what a UI prints ("5h", "7d", a scoped
 * model's display name).
 */
export interface EngineQuotaWindow {
  readonly kind: string
  readonly label: string
  /** Integer utilization percent, 0..100. */
  readonly percent: number
  /** Epoch-ms window reset, or null when the vendor didn't report one. */
  readonly resetsAt: number | null
}

/** Snapshot of an engine account's subscription-quota windows. */
export interface EngineQuotaUsage {
  readonly windows: readonly EngineQuotaWindow[]
  /** Epoch-ms fetch time — consumers derive staleness from this. */
  readonly capturedAt: number
}

/**
 * Vendor-supplied capability surface — the single way the TUI asks
 * "what does this engine know / offer?". Today that is one question:
 * how the engine wants its full-screen terminal UI adjusted. Add a member
 * here only together with the neutral-layer consumer that reads it.
 */
export interface EngineCapabilities {
  /** Optional vendor-owned adjustments for its full-screen terminal UI. */
  readonly terminalPresentation?: EngineTerminalPresentation
}

/**
 * Product identity surfaced by the engine adapter — the composer asks
 * the engine how it wants to be named instead of hard-coding vendor
 * strings in TUI code.
 */
export interface EngineIdentity {
  readonly vendorId: VendorId
  readonly shortName: string
}

/**
 * One historical message read off disk by an engine adapter's history
 * module. `blocks` is the vendor-neutral discriminated union (see
 * `types/content.ts`); adapters normalize their native shape into it
 * before surfacing. `timestamp` is ISO-8601 to match Claude Code's
 * JSONL on-disk format.
 */
export interface Message {
  readonly role: "user" | "assistant" | "system"
  readonly blocks: readonly ContentBlock[]
  readonly timestamp: string
  readonly sessionId: string
  /**
   * Anthropic token usage for this assistant turn, when persisted on
   * disk. Claude Code stores it inline on each assistant record's
   * `message.usage`. Surfaced so the monitor's cost dashboard can
   * aggregate without re-parsing the raw JSONL.
   */
  readonly usage?: {
    readonly input_tokens: number
    readonly output_tokens: number
    readonly cache_read_input_tokens?: number
    readonly cache_creation_input_tokens?: number
  }
}

/**
 * Per-turn usage snapshot — what an adapter's history module surfaces
 * alongside the message list. Fields are vendor-neutral; not all
 * adapters fill every field.
 */
export type EngineUsageSnapshot = {
  readonly input_tokens: number
  readonly output_tokens: number
  readonly cache_read_input_tokens?: number
  readonly cache_creation_input_tokens?: number
  /** Tokens currently in the session's context window, when known. */
  readonly context_tokens?: number
  /** True when `context_tokens` is kobe-estimated rather than engine-reported. */
  readonly context_tokens_approximate?: boolean
  /** Model context window, when known. */
  readonly context_window_tokens?: number
}

/**
 * What `engine/<vendor>/history.ts` returns: the full message list plus
 * an aggregate usage snapshot for the session.
 */
export interface EngineHistory {
  readonly messages: readonly Message[]
  readonly usageMetrics?: EngineUsageSnapshot
}
