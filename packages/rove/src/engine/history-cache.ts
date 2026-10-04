/**
 * Append-aware per-file transcript parse cache for the engine history readers.
 *
 * The history pane re-reads transcripts every ~2.5s; a full re-parse yields
 * all-new object identities (React then recreates every row) and is O(n²)
 * allocation over a session. So the parsed prefix is cached and only the
 * appended slice parsed, keeping the SAME refs for seen records.
 *
 * Soundness: the boundary always sits on a `\n`, so a partially flushed tail
 * is re-parsed each call and never cached. Rewrite/truncation (compaction,
 * resume-branch rewrites) is detected by prefix length + SHA-256 of the prefix
 * (content itself is not retained); any mismatch re-parses in full.
 *
 * `S` is the vendor's fold state, including cross-line state (copilot's
 * session.start id).
 */

import { createHash } from "node:crypto"
import type { Message } from "@/types/engine"

export interface AppendParseCacheOptions<S, C> {
  /** Fold state for an empty transcript (before any complete line). */
  initial: (ctx: C) => S
  /**
   * Return NEW state WITHOUT mutating `prev` (the cached prefix state is shared;
   * clone before appending). Must be associative over line boundaries:
   * `parseChunk(b, parseChunk(a, s))` === `parseChunk(a + b, s)` when `a` ends at `\n`.
   */
  parseChunk: (chunk: string, prev: S, ctx: C) => S
  /** Cap on cached files; evict the least recently updated prefix (default 8). */
  maxFiles?: number
}

interface CacheEntry<S, C> {
  context: C
  /** Char length of the cached prefix — always ends at a `\n` boundary. */
  prefixLength: number
  /** SHA-256 hex of `raw.slice(0, prefixLength)` at cache time. */
  prefixHash: string
  /** Fold state over that prefix (messages + any vendor carry-over). */
  state: S
}

/** Call the result with the full current contents of `filePath`. */
export function createAppendParseCache<S, C = void>(
  opts: AppendParseCacheOptions<S, C>,
): (filePath: string, raw: string, ctx: C) => S {
  const maxFiles = opts.maxFiles ?? 8
  const cache = new Map<string, CacheEntry<S, C>>()

  function remember(filePath: string, entry: CacheEntry<S, C>): void {
    cache.delete(filePath) // re-insert so Map order tracks recency of writes
    cache.set(filePath, entry)
    if (cache.size > maxFiles) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
  }

  return function parseCached(filePath: string, raw: string, ctx: C): S {
    const stableLength = raw.lastIndexOf("\n") + 1
    const entry = cache.get(filePath)
    const verifiedLength = Math.min(entry?.prefixLength ?? 0, stableLength)
    // Reuse this hash after verification; extending it feeds only the suffix.
    const hash = createHash("sha256").update(raw.slice(0, verifiedLength))

    const unchanged =
      entry !== undefined &&
      Object.is(entry.context, ctx) &&
      entry.prefixLength <= stableLength &&
      hash.copy().digest("hex") === entry.prefixHash
    let prefixState: S
    if (unchanged) {
      prefixState =
        entry.prefixLength < stableLength
          ? opts.parseChunk(raw.slice(entry.prefixLength, stableLength), entry.state, ctx)
          : entry.state
    } else {
      prefixState = opts.parseChunk(raw.slice(0, stableLength), opts.initial(ctx), ctx)
    }

    if (!unchanged || entry.prefixLength !== stableLength || entry.state !== prefixState) {
      remember(filePath, {
        context: ctx,
        prefixLength: stableLength,
        prefixHash: hash.update(raw.slice(verifiedLength, stableLength)).digest("hex"),
        state: prefixState,
      })
    }

    const tail = raw.slice(stableLength)
    return tail.trim().length > 0 ? opts.parseChunk(tail, prefixState, ctx) : prefixState
  }
}

/**
 * Timestamp ASC. File order isn't chronological (Claude's JSONL is a DAG via
 * `parentUuid`, so resumes interleave branches) and the chat pane needs
 * `past[]` chronological. Stable: ties keep file order, roughly causal.
 */
const sortedMessages = new WeakMap<readonly Message[], readonly Message[]>()

/** Parse folds publish immutable arrays, so a snapshot only needs sorting once. */
export function sortByTimestamp(messages: readonly Message[]): readonly Message[] {
  const hit = sortedMessages.get(messages)
  if (hit) return hit
  const sorted = [...messages].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))
  sortedMessages.set(messages, sorted)
  return sorted
}
