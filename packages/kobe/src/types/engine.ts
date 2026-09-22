/**
 * Engine-derived data types. Engines run as interactive CLIs in Hosted PTYs
 * and own their conversation lifecycle; adapters expose history, identity,
 * launch, capabilities, and telemetry.
 *
 * `Message` / `EngineHistory` / `EngineUsageSnapshot` are the vendor-neutral
 * shape each adapter's history module normalizes its on-disk JSONL into;
 * renderers consume these, never raw vendor records. `ContentBlock`'s
 * taxonomy is owned by `types/content.ts`. `EngineCapabilities` /
 * `EngineIdentity` are read through the engine registry.
 */

import type { EngineQuotaUsage, EngineQuotaWindow } from "@sma1lboy/kobe-daemon/daemon/contracts"
import type { ContentBlock } from "./content"
import type { EngineTerminalPresentation } from "./terminal-presentation"

export type { EngineQuotaUsage, EngineQuotaWindow }
export type { ContentBlock } from "./content"

/**
 * The single way neutral layers ask what an engine offers. Add a member only
 * together with the neutral-layer consumer that reads it.
 */
export interface EngineCapabilities {
  /** Rewrite the prompt before delivery submits it with Enter. Delivery never
   *  reads the screen, so an engine whose composer needs something closed
   *  first (a mention popup) says so here, in the text. */
  readonly preparePromptSubmission?: (prompt: string) => string | null
  /** Non-text keys to finish composer preparation, outside the paste wrapper
   *  and immediately before the shared Enter. */
  readonly beforePromptSubmit?: string
  /** Optional vendor-owned adjustments for its full-screen terminal UI. */
  readonly terminalPresentation?: EngineTerminalPresentation
  /**
   * Bytes that stop the current turn, typed into the pty (`rove api interrupt`).
   * Vendor-owned: Esc cancels a turn in one engine and ctrl-C quits it, and
   * others swap them. Absent = the verb refuses (`UNSUPPORTED`); a wrong guess
   * kills the session instead of pausing it.
   */
  readonly interruptSequence?: string
}

/** How the engine wants to be named, so TUI code never hard-codes vendor strings. */
export interface EngineIdentity {
  readonly shortName: string
}

/**
 * One historical message read off disk. `blocks` is the vendor-neutral union
 * from `types/content.ts`; `timestamp` is ISO-8601, matching Claude Code's JSONL.
 */
export interface Message {
  readonly role: "user" | "assistant" | "system"
  readonly blocks: readonly ContentBlock[]
  readonly timestamp: string
  readonly sessionId: string
  /** Token usage for this assistant turn, when persisted (Claude Code's `message.usage`). */
  readonly usage?: {
    readonly input_tokens: number
    readonly output_tokens: number
    readonly cache_read_input_tokens?: number
    readonly cache_creation_input_tokens?: number
  }
}

/** Vendor-neutral usage snapshot; not every adapter fills every field. */
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

/** What `engine/<vendor>/history.ts` returns: messages plus the session's aggregate usage. */
export interface EngineHistory {
  readonly messages: readonly Message[]
  readonly usageMetrics?: EngineUsageSnapshot
}
