/**
 * Payloads for the standalone PTY host's v4 socket, versioned and restarted
 * independently of the daemon — a change here is a compat question for that
 * socket alone. Re-exported from `protocol.ts`.
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
  /** Dead child's pid (null if spawn failed), so a client that reopened the
   *  key can tell the old incarnation's exit from the new one's. Absent from
   *  pre-pid hosts. */
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
  /** This open created the session (fresh spawn or warm-shell adoption) —
   *  cue to type `initialInput`. False on reattach; absent from pre-warm hosts. */
  readonly created?: boolean
  /** This open respawned a freeze-restored corpse: `replay` is pre-restart
   *  scrollback, the child is new and ran the caller's launch spec (e.g.
   *  `--resume`). Unlike `created`, a prompt in the launch argv already rode
   *  the spawn, so the caller must not paste it too. Absent from pre-freeze hosts. */
  readonly respawned?: boolean
  /** Monotonic total bytes written at attach time; a reattaching client
   *  passes it as `sinceOffset` to get only the delta. Absent from pre-offset hosts. */
  readonly offset?: number
  /** `replay` is exactly the delta since `sinceOffset` (still in the ring), so
   *  the client may restore its serialized screen and apply it. False/absent =
   *  full ring (offset trimmed, or an old host). */
  readonly sinceValid?: boolean
}

/** `pty.peek` response — read-only ring snapshot; never attaches, spawns or
 *  resizes, so safe for observation (`kobe api read-output` fallback). */
export interface PtyPeekResult {
  /** False when no session exists under the key (nothing was spawned). */
  readonly exists: boolean
  readonly alive: boolean
  /** The session child's pid (null when spawn failed or `exists` is false).
   *  Callers pin pagination to it: a different pid = a new incarnation. */
  readonly pid: number | null
  /** Monotonic total bytes written — the caller's next `sinceOffset`. */
  readonly offset: number
  /** Ring bytes (base64): the full ring, or exactly the delta since the
   *  request's `sinceOffset` when `sinceValid`. */
  readonly data: string
  /** `data` is the exact delta since `sinceOffset`; false = offset trimmed, full ring. */
  readonly sinceValid: boolean
  /** How the child died when `alive` is false — null while alive, absent
   *  from pre-exit-info hosts. */
  readonly exit?: PtySessionExit | null
}
