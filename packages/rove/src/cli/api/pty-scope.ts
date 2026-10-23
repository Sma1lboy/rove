/**
 * Whose PTYs a task's liveness and tab reads cover. A migrated child's
 * conversation is a hosted PTY keyed under its parent: the child reads it
 * there (`alias`), and no other task counts it (`claimed`).
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { type AliasRef, aliasKey, aliasedKeys, isUnderKey } from "@sma1lboy/rove-daemon/daemon/pty-alias"
import type { DaemonRpc } from "../daemon-session.ts"

export interface PtyScope {
  /** The task's own aliased PTY, when it is a migrated child. */
  readonly alias?: AliasRef
  /** Every task's aliased PTY key: sessions that belong to a child, not to the task named by the key. */
  readonly claimed?: readonly string[]
}

/** Advisory like the task list it reads: unreadable, the scope claims nothing. */
export async function ptyScopeOf(daemon: DaemonRpc, task: SerializedTask): Promise<PtyScope> {
  const listed = await daemon.request<{ tasks: SerializedTask[] }>("task.list", {}).catch(() => ({ tasks: [] }))
  return { ...(task.ptyAlias ? { alias: task.ptyAlias } : {}), claimed: aliasedKeys(listed.tasks) }
}

/** `sessions` minus those another task's alias claims (this task's own alias stays). */
export function unclaimedSessions<T extends { readonly key: string }>(
  sessions: readonly T[],
  scope: PtyScope | undefined,
): T[] {
  const own = scope?.alias ? aliasKey(scope.alias) : undefined
  const foreign = (scope?.claimed ?? []).filter((base) => base !== own)
  return sessions.filter((s) => !foreign.some((base) => isUnderKey(s.key, base)))
}
