/**
 * PTY protocol payloads — split out of `protocol.ts` to keep that file under
 * the ~500 line cap. These types travel on the standalone PTY host socket
 * (v4 protocol) and are re-exported from `protocol.ts` for existing callers.
 */

/** How a session's child ended — recorded at exit time by the PTY host.
 *  `code` XOR `signal` is set for a normal wait; both null means the
 *  driver could not tell (spawn failure, pre-exit-info host). */
export interface PtySessionExit {
  readonly code: number | null
  readonly signal: string | null
  /** ISO timestamp of when the host observed the exit. */
  readonly at: string
}

/** Targeted `pty.data` event payload — one ordered chunk of PTY output. */
export interface PtyDataEventPayload {
  /** The PTY session key (the TUI's registry key, e.g. `taskId::tabId`). */
  readonly key: string
  /** Raw child output bytes, base64-encoded (JSON-lines wire). */
  readonly data: string
}

/** Targeted `pty.exit` event payload — the session's child ended. */
export interface PtyExitEventPayload {
  readonly key: string
  /** The dead child's pid (null when spawn failed). Lets a client that
   *  kill()ed + reopened the same key tell the OLD incarnation's exit
   *  apart from its new session's — absent from pre-pid hosts. */
  readonly pid?: number | null
  /** Exit status/signal/time — absent from pre-exit-info hosts. */
  readonly code?: number | null
  readonly signal?: string | null
  readonly at?: string
}

/** `pty.open` response — attach result for one session key. */
export interface PtyOpenResult {
  /** Ring-buffer replay (base64) — everything the child wrote, capped. */
  readonly replay: string
  /** False when the session exists but its child already exited. */
  readonly alive: boolean
  /** This session's child pid (null when spawn failed) — the client keys
   *  `pty.exit` frames against it; absent from pre-pid hosts. */
  readonly pid?: number | null
  /** True when THIS open brought the session into being (fresh spawn or
   *  warm-shell adoption) — the client's cue that `initialInput` may be
   *  typed. False on reattach; absent from pre-warm hosts. */
  readonly created?: boolean
  /** True when THIS open respawned a freeze-restored corpse in place:
   *  `replay` is the pre-restart scrollback and the child is brand new
   *  (the caller's launch spec won — e.g. the TUI's engine `--resume`).
   *  Distinct from `created` because the spawn spec was NOT swallowed by
   *  a live session: a prompt embedded in the launch argv DID ride it,
   *  so the caller must not also paste it. Absent from pre-freeze hosts. */
  readonly respawned?: boolean
  /** Monotonic per-session byte offset at attach time (total bytes the
   *  child has ever written). A client that detaches records it and asks
   *  the next `pty.open` for only the delta via `sinceOffset`; absent
   *  from pre-offset hosts. */
  readonly offset?: number
  /** True when the request's `sinceOffset` was still inside the ring
   *  window and `replay` is exactly the bytes written since it — the
   *  client may restore its serialized screen and apply the delta.
   *  False/absent means `replay` is the full ring (offset trimmed away,
   *  or an old host). */
  readonly sinceValid?: boolean
}

/**
 * `pty.peek` response — a read-only ring-buffer snapshot for one session
 * key. Unlike `pty.open` it never attaches, spawns, or resizes, so it is
 * safe for pure observation (`kobe api read-output` terminal fallback).
 */
export interface PtyPeekResult {
  /** False when no session exists under the key (nothing was spawned). */
  readonly exists: boolean
  readonly alive: boolean
  /** The session child's pid (null when spawn failed or `exists` is false).
   *  Callers pin pagination to it: a different pid = a new incarnation. */
  readonly pid: number | null
  /** Monotonic total bytes the child has ever written — the caller's next
   *  `sinceOffset`. */
  readonly offset: number
  /** Ring bytes (base64): the full ring, or exactly the delta since the
   *  request's `sinceOffset` when `sinceValid`. */
  readonly data: string
  /** True when `data` is the exact delta since `sinceOffset` (still inside
   *  the ring window); false means the offset was trimmed away and `data`
   *  is the full ring. */
  readonly sinceValid: boolean
  /** How the child died when `alive` is false — null while alive, absent
   *  from pre-exit-info hosts. */
  readonly exit?: PtySessionExit | null
  /** Epoch ms of the most recent attached-client write. Absent when the host
   *  predates human-write tracking; callers treat absence as "no recent
   *  write" (fail-open for the A-layer gate). */
  readonly lastHumanWriteMs?: number
  /** The host's configured human-write quiet period (ms). Callers compare
   *  `lastHumanWriteMs + humanWriteQuietMs` against now to decide whether a
   *  paste is safe. Absent from older hosts. */
  readonly humanWriteQuietMs?: number
}
