/**
 * Dispatcher provenance — the collaboration loop's reply address. A task
 * created from inside another kobe engine tab records WHO dispatched it
 * (`dispatcher: {taskId, tabId}`), and a bare `send` from that task replies
 * to exactly that tab. Holds both the create-side stamping and the send-side
 * routing.
 */

import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { kobeApiInvocation } from "../../engine/interactive-command.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { activeCliName } from "../rename-compat.ts"
import { ApiError, type ApiRuntime } from "./types.ts"

/** The dispatcher pair as recorded on a task. */
export type Dispatcher = NonNullable<SerializedTask["dispatcher"]>

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
  const [{ openPtyHost, listSessions }, { psSnapshot }] = await Promise.all([
    import("./pty-delivery.ts"),
    import("../../engine/foreground.ts"),
  ])
  return {
    sessions: async () => {
      const host = await openPtyHost()
      if (!host) return []
      try {
        return await listSessions(host.rpc)
      } finally {
        host.close()
      }
    },
    ps: psSnapshot,
    pid: process.pid,
  }
}

/**
 * The caller's OWN kobe session identity — `$KOBE_TASK_ID`/`$KOBE_TAB_ID`
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
  const taskId = env.KOBE_TASK_ID
  if (!taskId) return null
  const tabId = env.KOBE_TAB_ID || "tab-1"
  try {
    const p = probe ?? (await realProbe())
    const key = `${taskId}::${tabId}`
    const session = (await p.sessions()).find((s) => s.key === key && s.alive)
    if (session?.pid) {
      const { hasAncestor, parsePsSnapshot } = await import("../../engine/foreground.ts")
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
  identityWarning = `$ROVE_TASK_ID/$KOBE_TASK_ID names task ${taskId} ${tabId}, but this process is not running inside that tab (an inherited env, not an identity) — dispatcher/peer provenance omitted`
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
 * `task.create` payload fields naming the caller as the dispatcher — empty
 * from a plain shell, and equally empty when the env fails
 * {@link verifiedSelfSession}.
 */
export async function dispatcherEnvPayload(
  env: NodeJS.ProcessEnv = process.env,
  probe?: SelfSessionProbe,
): Promise<Record<string, string>> {
  const self = await verifiedSelfSession(env, probe)
  if (!self) return {}
  return { dispatcherTaskId: self.taskId, dispatcherTabId: self.tabId }
}

/**
 * The dispatcher recorded on the CALLER's own task, when the caller is a
 * VERIFIED kobe session that has one. `null` (keep the active-task default)
 * when the caller isn't a kobe session, its env didn't verify, or the task
 * predates the field / was created outside a kobe session.
 */
export async function readOwnDispatcher(daemon: DaemonRpc): Promise<Dispatcher | null> {
  const self = await verifiedSelfSession()
  if (!self) return null
  try {
    const res = await daemon.request<{ task: SerializedTask }>("task.get", { taskId: self.taskId })
    return res.task.dispatcher ?? null
  } catch {
    return null
  }
}

/**
 * Pick the tab a dispatcher-defaulted `send` lands on: the dispatched-from
 * tab, else the dispatcher task's canonical live engine tab, NEVER a silent
 * spawn — with nothing alive it throws a typed error. `undefined` means "the
 * canonical tab" in the delivery layer's spelling.
 */
export async function resolveDispatcherTab(runtime: ApiRuntime, dispatcher: Dispatcher): Promise<string | undefined> {
  const { tabs, running } = await runtime.taskTabs(dispatcher.taskId)
  // Only when ALIVE: the tab join also lists live sessions the snapshot never
  // registered, and a tab merely gone from the snapshot gets the canonical
  // fallback instead of a TAB_NOT_FOUND at delivery.
  if (tabs.some((t) => t.id === dispatcher.tabId && t.alive)) return dispatcher.tabId
  // Gated on a live engine tab: the canonical path COLD-STARTS an engine for
  // a task with none — right for a first prompt, wrong for a reply.
  if (running) return undefined
  throw new ApiError(
    `dispatcher tab ${dispatcher.tabId} on task ${dispatcher.taskId} is dead and the task has no live engine tab — the reply has nowhere to land`,
    "DISPATCHER_UNREACHABLE",
    {
      dispatcher,
      hint: `address an alive target explicitly with --task-id/--tab (see \`${activeCliName()} api pty-list\`), or notify the user with \`${activeCliName()} api notify\``,
      nextCommandArgs: ["api", "pty-list"],
    },
  )
}

/**
 * Peer provenance: a prompt issued from INSIDE another kobe task tells the
 * receiver who is talking and how to answer.
 *
 * Both delivery verbs wear it, `add --prompt` included: otherwise the sender
 * is only the task ROW's `dispatcher`, which a receiver has no reason to go
 * read, so a dispatched task finishes and then sits waiting. Same convention
 * as field notes (`[ROVE FIELD NOTE] from "<label>" (task <id>)`), plus the
 * reply command. Sender is the VERIFIED $KOBE_TASK_ID/$KOBE_TAB_ID pair — an
 * unverified one would bake a stranger's tab into the reply command. A send
 * from a plain shell, an unverified process, or to yourself stays untouched.
 */
export async function withPeerProvenance(daemon: DaemonRpc, targetTaskId: string, prompt: string): Promise<string> {
  const self = await verifiedSelfSession()
  const senderId = self?.taskId
  if (!senderId || senderId === targetTaskId) return prompt
  let label = senderId
  try {
    const res = await daemon.request<{ task: SerializedTask }>("task.get", { taskId: senderId })
    label = res.task.title || res.task.branch || senderId
  } catch {
    /* stale env id — keep id-only provenance rather than dropping it */
  }
  const api = kobeApiInvocation()
  // The sender's TAB, not just its task: task-granular replies go through
  // canonical-tab resolution, the link that breaks. $KOBE_TAB_ID is exported
  // into every engine tab (session-launch.ts).
  const replyTarget = `--task-id ${senderId} --tab ${self.tabId}`
  // A pointer, not a curriculum: every peer message pays for this prefix in
  // context. The skill is required ONCE PER SESSION — a receiver replying
  // from the raw prefix alone improvises verbs and side-channels.
  //
  // "reply only if it changes what I do next": an unconditional "reply" made
  // peers acknowledge every message (and each other's acknowledgements), one
  // full engine turn apiece.
  // The sender's text goes LAST, whole, after a blank line: a model replies
  // in the language of the tokens nearest its turn, so wrapping a Chinese
  // prompt in an English clause pulls replies into English.
  return `[ROVE PEER] from "${label}" (task ${senderId} — Rove agent skill /rove, read it once per session (legacy /kobe installs still work); reply only if it changes what I do next: \`${api} send ${replyTarget} --prompt "<text>"\`; verb reference: \`${api} schema\`)\n\n${prompt}`
}
