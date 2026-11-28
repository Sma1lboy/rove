/**
 * The caller's own rove session identity and the dispatch-ledger record of a
 * paste: the half of dispatcher provenance that machine forwarding needs too.
 * Reply-address routing on top of it is `cli/api/dispatcher.ts`.
 */

import type { DaemonRpc } from "@sma1lboy/rove-core/client/daemon-session.ts"
import { resolvePtyOwner } from "@sma1lboy/rove-daemon/daemon/cwd-task"
import { DISPATCH_PROMPT_HEAD_CHARS } from "@sma1lboy/rove-daemon/daemon/dispatch-ledger"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"

/** The dispatcher pair as recorded on a task. */
export type Dispatcher = NonNullable<SerializedTask["dispatcher"]>

/** Tell the daemon's dispatch ledger about a paste it never saw; best-effort, an older daemon refuses the verb. */
export async function recordSend(
  daemon: DaemonRpc,
  sent: { taskId: string; tabId?: string; prompt: string; delivered: boolean; deliveryId?: string },
): Promise<void> {
  const self = await ownSession(daemon).catch(() => null)
  await daemon
    .request("dispatch.record", {
      taskId: sent.taskId,
      ...(sent.tabId ? { tabId: sent.tabId } : {}),
      promptHead: sent.prompt.slice(0, DISPATCH_PROMPT_HEAD_CHARS),
      delivered: sent.delivered,
      ...(sent.deliveryId ? { deliveryId: sent.deliveryId } : {}),
      ...(self ? { fromTaskId: self.taskId, fromTabId: self.tabId } : {}),
    })
    .catch(() => {})
}

/** The two reads {@link verifiedSelfSession} needs; injectable for tests. */
export interface SelfSessionProbe {
  /** Live pty-host inventory (`pty.list`) — `[]` when the host is gone. */
  sessions(): Promise<readonly { key: string; pid: number | null; alive: boolean }[]>
  /** Snapshot text, given the pids whose consoles the walk runs through — the tab's shell and this CLI (see `PsSnapshot`). */
  ps(anchors?: readonly number[]): Promise<string>
  /** This process's pid — the far end of the lineage walk. */
  pid: number
}

/** One resolution per CLI process — see {@link verifiedSelfSession}. */
let selfSessionOnce: Promise<Dispatcher | null> | undefined

/** Set by a refused resolution, drained by {@link takeIdentityWarning}. */
let identityWarning: string | null = null

async function realProbe(): Promise<SelfSessionProbe> {
  const [{ openHostedSessionHost, listHostedSessions }, { psSnapshot }] = await Promise.all([
    import("../engine/hosted-session.ts"),
    import("../engine/foreground.ts"),
  ])
  return {
    sessions: async () => {
      const host = await openHostedSessionHost()
      if (!host) return []
      try {
        return await listHostedSessions(host.rpc)
      } finally {
        host.close()
      }
    },
    ps: psSnapshot,
    pid: process.pid,
  }
}

/**
 * The caller's OWN rove session identity — `$ROVE_TASK_ID`/`$ROVE_TAB_ID`
 * cross-checked against the pty host, or `null` when it doesn't hold up.
 *
 * The env alone is NOT identity: it inherits down the process tree, so a
 * background daemon forked out of an engine tab carries that tab's ids and
 * every task IT creates would name a stranger's session as dispatcher. The
 * env is believed only when:
 *
 *   1. `<taskId>::<tabId>` is a session the pty host lists as ALIVE, and
 *   2. that session's shell pid is an ANCESTOR of this process.
 *
 * (2) is what inherited env can't fake: a detached process reparents to init.
 *
 * Unverifiable is UNVERIFIED (no host, no ps, a killed tab): a wrong reply
 * address delivers to someone else instead of failing.
 *
 * Memoized: one `pty.list` + one `ps` per CLI process (`send` asks twice).
 */
export async function verifiedSelfSession(
  env: NodeJS.ProcessEnv = process.env,
  probe?: SelfSessionProbe,
): Promise<Dispatcher | null> {
  // An explicit probe always re-resolves (a test walking several env shapes
  // must not read the previous one's answer) and PRIMES the memo, so the
  // verbs it then drives resolve the same identity without real IO.
  if (!probe && selfSessionOnce) return selfSessionOnce
  const run = resolveSelfSession(env, probe)
  selfSessionOnce = run
  return run
}

/** Drop the memo — tests only (one process, many env fixtures). */
export function resetVerifiedSelfSession(): void {
  selfSessionOnce = undefined
}

async function resolveSelfSession(env: NodeJS.ProcessEnv, probe?: SelfSessionProbe): Promise<Dispatcher | null> {
  const taskId = env.ROVE_TASK_ID
  if (!taskId) return null
  const tabId = env.ROVE_TAB_ID || "tab-1"
  try {
    const p = probe ?? (await realProbe())
    const key = `${taskId}::${tabId}`
    const session = (await p.sessions()).find((s) => s.key === key && s.alive)
    if (session?.pid) {
      const { hasAncestor, parsePsSnapshot } = await import("../engine/foreground.ts")
      // Both ends of the walk are anchors: the tab's shell, whose console
      // re-links the engine to it, and this CLI, whose console re-links it
      // to the engine's Bash tool — Windows severs the chain at both places
      // (win-process-snapshot.ts). POSIX ignores the list.
      if (hasAncestor(parsePsSnapshot(await p.ps([session.pid, p.pid])), p.pid, session.pid)) {
        // Clears a previous resolution's warning (only reachable if the memo
        // is ever relaxed).
        identityWarning = null
        return { taskId, tabId }
      }
    }
  } catch {
    /* unreadable host/ps — fall through to the refusal below */
  }
  // Never a SILENT degrade. stderr carries exactly one JSON error envelope by
  // contract (docs/API.md), so the notice rides the verb's stdout result —
  // see `takeIdentityWarning`.
  identityWarning = `$ROVE_TASK_ID/$ROVE_TASK_ID names task ${taskId} ${tabId}, but this process is not running inside that tab (an inherited env, not an identity) — dispatcher/peer provenance omitted`
  return null
}

/**
 * The one-shot "your session identity didn't verify" notice, merged into the
 * verb's JSON result by the api dispatcher so an agent SEES the degrade
 * instead of silently losing its reply address. Read-and-clear.
 */
export function takeIdentityWarning(): string | null {
  const warning = identityWarning
  identityWarning = null
  return warning
}

/**
 * The caller's verified session as the TASK it speaks for. A migrated child's
 * conversation is a PTY keyed under its parent, so that PTY's env names the
 * parent: stamping or replying to the raw pair would address the wrong
 * conversation. The task list is advisory — unreadable, the raw pair stands.
 */
export async function ownSession(
  daemon: DaemonRpc,
  env: NodeJS.ProcessEnv = process.env,
  probe?: SelfSessionProbe,
): Promise<Dispatcher | null> {
  const self = await verifiedSelfSession(env, probe)
  if (!self) return null
  const listed = await daemon.request<{ tasks: SerializedTask[] }>("task.list", {}).catch(() => ({ tasks: [] }))
  return { ...self, taskId: resolvePtyOwner(listed.tasks, self.taskId, self.tabId) }
}

/**
 * `task.create` payload fields naming the caller as the dispatcher — empty
 * from a plain shell, and equally empty when the env fails
 * {@link verifiedSelfSession}.
 */
export async function dispatcherEnvPayload(
  daemon: DaemonRpc,
  env: NodeJS.ProcessEnv = process.env,
  probe?: SelfSessionProbe,
): Promise<Record<string, string>> {
  const self = await ownSession(daemon, env, probe)
  if (!self) return {}
  return { dispatcherTaskId: self.taskId, dispatcherTabId: self.tabId }
}

/** The caller's verified session and the dispatcher recorded on its task. */
export interface OwnReplyRoute {
  self: Dispatcher
  dispatcher: Dispatcher | null
}

/**
 * The caller as a VERIFIED rove session, with the dispatcher on its own task
 * (`null`: created outside a rove session, made top level, or unreadable).
 * `null` overall when the caller isn't a rove session or its env didn't verify.
 */
export async function readOwnDispatcher(daemon: DaemonRpc): Promise<OwnReplyRoute | null> {
  const self = await ownSession(daemon)
  if (!self) return null
  try {
    const res = await daemon.request<{ task: SerializedTask }>("task.get", { taskId: self.taskId })
    return { self, dispatcher: res.task.dispatcher ?? null }
  } catch {
    return { self, dispatcher: null }
  }
}
