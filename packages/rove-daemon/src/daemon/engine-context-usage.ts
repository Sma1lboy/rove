/**
 * Context half of one live session's usage snapshot. Structural mirror of
 * rove's `EngineUsageSnapshot` (`rove/src/types/engine.ts`, source of truth);
 * the engine's history reader computes it, never the daemon (vendor arithmetic).
 *
 * An unreported token count is absent, never `0`: "used no cache" and "engine
 * doesn't say" must stay distinguishable.
 */
export interface EngineContextUsage {
  /** Tokens currently in the session's context window. */
  readonly contextTokens: number
  /** The model's context window, when the vendor reports one. */
  readonly contextWindowTokens?: number
  /** True when `contextTokens` is estimated rather than engine-reported. */
  readonly approximate?: boolean
  /** Prompt tokens billed across the whole session, when the vendor reports them. */
  readonly inputTokens?: number
  /** Completion tokens across the whole session, when the vendor reports them. */
  readonly outputTokens?: number
  /** Cache-read tokens across the whole session, when the vendor reports them. */
  readonly cacheReadTokens?: number
  /** Cache-write tokens across the whole session, when the vendor reports them. */
  readonly cacheCreationTokens?: number
  /** What `contextTokens` is made of (`system`, `messages`), when the engine records it; parts sum to it. */
  readonly parts?: readonly {
    readonly key: string
    readonly tokens: number
    readonly label?: string
    readonly items?: readonly { readonly name: string; readonly tokens: number }[]
    /** How many things the part holds, when `items` lists only the largest. */
    readonly itemCount?: number
  }[]
}
