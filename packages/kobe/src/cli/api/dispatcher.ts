/**
 * Dispatcher provenance — the collaboration loop's reply address.
 *
 * A task created from inside another kobe engine tab records WHO dispatched
 * it (`dispatcher: {taskId, tabId}`), and a bare `send` from that task
 * replies to exactly that tab. Completion flows back through `send` into the
 * dispatching chat tab; this module is the address that makes that route
 * computable instead of hand-relayed.
 *
 * Both halves live here rather than in `handler-helpers.ts` so the stamping
 * (create-side) and the routing (send-side) stay one readable concern.
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
  /** Snapshot text, given the shell pids the walk anchors on (see `PsSnapshot`). */
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
 * The env alone is NOT identity. It is an ordinary variable and inherits
 * down the entire process tree, so a Claude Code background daemon forked
 * out of an engine tab carries that tab's ids for as long as it lives — and
 * every task IT creates would record a dispatcher pointing at a stranger's
 * session, which is where finished workers would report. Two things have to
 * be true for the env to be believed:
 *
 *   1. `<taskId>::<tabId>` is a session the pty host lists as ALIVE, and
 *   2. that session's shell pid is an ANCESTOR of this process.
 *
 * (2) is what the inherited env can't fake: a detached background process
 * reparents to init and stops reaching the tab's shell. A real `kobe api`
 * call from inside the tab — engine → its Bash tool → this CLI — always
 * does.
 *
 * Unverifiable is UNVERIFIED: no host, no ps, a killed tab. Recording a
 * wrong reply address is strictly worse than recording none, because the
 * wrong one delivers (to someone else) instead of failing.
 *
 * Memoized: one `pty.list` + one `ps` per CLI process, however many verbs
 * ask (`send` asks twice — routing and peer provenance).
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
      if (hasAncestor(parsePsSnapshot(await p.ps([session.pid])), p.pid, session.pid)) {
        // A verified resolution clears any warning a previous one left. The
        // memo makes that a single resolution per process today; this keeps
        // the pair honest if the memo is ever relaxed.
        identityWarning = null
        return { taskId, tabId }
      }
    }
  } catch {
    /* unreadable host/ps — fall through to the refusal below */
  }
  // Never a SILENT degrade: the caller believes
  // it is a kobe session and its dispatcher/peer fields just vanished. stderr
  // carries exactly one JSON error envelope by contract (docs/API.md), so the
  // notice rides the verb's own stdout result instead — see `takeIdentityWarning`.
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
 * Pick the tab a dispatcher-defaulted `send` lands on: the exact tab the
 * work was dispatched from first, the dispatcher task's canonical live
 * engine tab when that tab has died, and NEVER a silent spawn — with
 * nothing alive the send fails loud with a typed error: a fallback must not
 * impersonate success. `undefined` means "the canonical tab", the delivery layer's own
 * spelling for it.
 */
export async function resolveDispatcherTab(runtime: ApiRuntime, dispatcher: Dispatcher): Promise<string | undefined> {
  const { tabs, running } = await runtime.taskTabs(dispatcher.taskId)
  // The dispatched-from tab first, addressed only when it reads ALIVE: the
  // tab join also lists live sessions the persisted snapshot never
  // registered, so "present and alive" is the honest liveness
  // test and a tab that is merely gone from the snapshot still gets the
  // canonical fallback below instead of a TAB_NOT_FOUND at delivery.
  if (tabs.some((t) => t.id === dispatcher.tabId && t.alive)) return dispatcher.tabId
  // Dead dispatcher tab → the task's canonical live engine, gated on a live
  // engine tab existing. The canonical path legitimately COLD-STARTS an
  // engine for a task with no alive session at all — correct for
  // a first prompt, wrong for a reply: it would boot an engine nobody asked
  // for and address it as if it were the agent that dispatched the work.
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
 * Peer provenance: a prompt issued from INSIDE another kobe task is one agent
 * messaging another, and the receiver needs what a bare paste never carries —
 * who is talking and how to answer.
 *
 * Both delivery verbs wear it, `add --prompt` included. Without it on the
 * opening brief the sender is recorded only as `dispatcher` on the task ROW,
 * which a receiver would have to think to go read (`rove api get-task`) and
 * has no reason to suspect exists — so a dispatched task finishes its work
 * and then sits waiting. A task's opening brief is exactly the moment the
 * reply address matters, since every report it will ever send flows back
 * through it. Same convention as field
 * notes (`[ROVE FIELD NOTE] from "<label>" (task <id>)`), plus the reply
 * command so a peer conversation is symmetric without any coordinator.
 * Sender identity is the VERIFIED $KOBE_TASK_ID/$KOBE_TAB_ID pair, not the
 * raw env: an unverified one names a stranger's session as the sender and
 * bakes their tab into the reply command. A send from a plain
 * shell, an unverified process, or to yourself stays untouched.
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
  // The baked-in reply command carries the sender's TAB, not just its task
  // task-granular replies land on canonical-tab resolution, which is exactly
  // the link that breaks — tab-precise addressing is
  // the loop's durable route home. $KOBE_TAB_ID is exported into every
  // engine tab alongside $KOBE_TASK_ID (session-launch.ts).
  const replyTarget = `--task-id ${senderId} --tab ${self.tabId}`
  // The trailing pointer closes the loop for a receiver that has never seen
  // kobe: reply command baked in, and where to learn the rest (the herdr
  // "--skill first" trick) — a pointer, not a curriculum, since every peer
  // message pays for this prefix in context. Loading the skill is REQUIRED,
  // not suggested: a receiver that replies from the raw prefix alone
  // improvises verbs and side-channels, and the round-trip falls back to a
  // human relay.
  // The sender's text goes LAST, whole, after a blank line — never as the
  // object of this English sentence. A model generates in the language of
  // the tokens nearest its turn, so wrapping a Chinese prompt in an English
  // clause pulls replies into English; ending on the sender's own words
  // removes that pull without changing what the prefix says.
  return `[ROVE PEER] from "${label}" (task ${senderId} — load the Rove agent skill FIRST (registered as /rove; legacy /kobe installs still work), then reply: \`${api} send ${replyTarget} --prompt "<text>"\`; verb reference: \`${api} schema\`)\n\n${prompt}`
}
