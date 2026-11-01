/**
 * Verb handlers for task reads, prompt delivery and issue-update — the
 * `read` / `drive` / `edit` verbs that aren't a one-line `simpleRpc` in the
 * {@link VERBS} table. Task-ending verbs (with their teardown recovery) live
 * in `handlers-lifecycle.ts`.
 */

import { type SkipVerdict, deliveryFooter } from "@sma1lboy/rove-daemon/daemon/contracts"
import type { IssueStatus } from "@sma1lboy/rove-daemon/daemon/issues-store"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { hostedKeyFor } from "@sma1lboy/rove-daemon/daemon/pty-alias"
import { roveApiInvocation } from "../../engine/interactive-command.ts"
import { taskCwd } from "../../orchestrator/task-tree.ts"
import type { VendorId } from "../../types/vendor.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { activityView, readActivityRegistry } from "./activity-view.ts"
import { ownSession, readOwnDispatcher, recordSend, resolveDispatcherTab, withPeerProvenance } from "./dispatcher.ts"
import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { markGateAnswersDelivered, takeOwedGateAnswers } from "./handlers-gates.ts"
import { readRunnability } from "./handlers-runnability.ts"
import { conversationHome, failSharedChild, withFirstConversationLock } from "./handlers-spawn.ts"
import { filterTaskList, listFields, listFilters, projectTasks } from "./list-filter.ts"
import { ptyScopeOf } from "./pty-scope.ts"
import { resolveActiveTaskId } from "./runtime.ts"
import { taskEngineArgv } from "./tab-snapshot.ts"
import { ApiError, type VerbContext, type VerbSpec, helpStep, promptMayHaveLanded } from "./types.ts"

export async function issueUpdate(ctx: VerbContext): Promise<unknown> {
  const title = ctx.args.str("title")
  const body = ctx.args.str("body")
  const task = ctx.args.str("task")
  const status = ctx.args.enumOf<IssueStatus>("status")
  if (title === undefined && body === undefined && task === undefined && status === undefined) {
    throw new ApiError("issue-update requires --title, --body, --task, and/or --status", "MISSING_FLAG")
  }
  const repoRoot = ctx.args.requireRepo("repo")
  const id = ctx.args.int("id")
  let state: unknown
  if (title !== undefined || body !== undefined || task !== undefined) {
    // ONE mutate, so `--title X --task <bogus>` can't half-run: the store
    // applies all three fields under one lock, and the daemon's task-existence
    // check runs before it, so a rejected link writes nothing.
    //
    // `--task none` unlinks (carried as `taskId: null`); anything else links.
    // Linking IS the kanban move to In progress — the board column derives from
    // the link, not a stored column.
    const link = task === undefined ? {} : { taskId: task === "none" ? null : task }
    state = await simpleRpc(ctx, "issue.mutate", { repoRoot, op: { type: "update", id, title, body, ...link } })
  }
  // Its own `setStatus` op, after the update proved the issue exists: plugins'
  // `issue.changed` events key status changes on that op type.
  if (status !== undefined) {
    state = await simpleRpc(ctx, "issue.mutate", { repoRoot, op: { type: "setStatus", id, status } })
  }
  return state
}

/**
 * Refuse a `succeeded:` report from a worker whose branch carries no commits —
 * at `send`, where the claim enters, rather than at `land`'s EMPTY_BRANCH after
 * the coordinator may have archived the siblings.
 *
 * Deliberately narrow: a false NEGATIVE is cheap, a false POSITIVE blocks a
 * worker from reporting at all:
 *   - only a VERIFIED self session (the same identity `send` already trusts
 *     for dispatcher routing) — an unverified env names a stranger's branch;
 *   - only a MANAGED task: `main`/`dir` tasks have no Rove-created branch, and
 *     an agent on a main checkout legitimately reads `ahead: 0`;
 *   - only a DEFINITE `ahead === 0`. An unresolvable base reads null — an
 *     honest unknown, never grounds to refuse.
 *
 * Investigation and review tasks genuinely succeed with no commits, so
 * `--allow-empty` (the `git commit` spelling) says so outright.
 */
async function assertNotEmptySuccess(daemon: DaemonRpc, ctx: VerbContext, prompt: string): Promise<void> {
  if (ctx.args.bool("allow-empty")) return
  // Fullwidth colon too: a CJK IME types `succeeded：` without the agent noticing.
  if (!/^\s*succeeded\s*[:\uff1a]/i.test(prompt)) return
  const self = await ownSession(daemon)
  if (!self) return
  let sender: SerializedTask
  try {
    sender = (await daemon.request<{ task: SerializedTask }>("task.get", { taskId: self.taskId })).task
  } catch {
    return // stale id / unreadable task — an unknown is never grounds to refuse
  }
  if (sender.kind === "main" || sender.kind === "dir") return
  if (!sender.worktreePath) return
  // A throwing read is an unknown, and an unknown never refuses.
  let ahead: number | null
  try {
    // Against the task's RECORDED base (`add --base-branch`), like `collect`,
    // never the origin/main guess: on a branch cut from `release/2.x` the
    // guess reads an empty branch as `ahead: 2` and can false-positive too.
    ahead = (await ctx.runtime.readBranchSignals(sender.worktreePath, sender.baseRef)).ahead
  } catch {
    return
  }
  if (ahead !== 0) return
  const branch = sender.branch || "your branch"
  throw new ApiError(
    `refusing to report success: ${branch} has 0 commits — "succeeded" means COMMITTED, and this report would reach the coordinator as a clean success with nothing to land`,
    "EMPTY_SUCCESS_REPORT",
    {
      taskId: self.taskId,
      branch,
      hint: "commit your work with a real message and send again — or, if this task genuinely produced no commits (an investigation or a review), re-send with --allow-empty to say so explicitly",
      // Carry the caller's target forward, or the verbatim retry re-resolves
      // via the active-task fallback and could land in a DIFFERENT task.
      nextCommandArgs: [
        "api",
        "send",
        ...(ctx.args.str("task-id") ? ["--task-id", ctx.args.str("task-id") as string] : []),
        ...(ctx.args.str("tab") ? ["--tab", ctx.args.str("tab") as string] : []),
        "--allow-empty",
        "--prompt",
        prompt,
      ],
    },
  )
}

/** `--prompt` or `--prompt-file`, and one of them must be there. */
export function requirePromptText(ctx: VerbContext, verb: string): string {
  const text = ctx.args.promptText()
  if (text === undefined) throw new ApiError("--prompt (or --prompt-file) is required", "MISSING_FLAG", helpStep(verb))
  return text
}

/**
 * The task a send goes to: `--task-id`, else — inside a sub-task — its DISPATCHER (task + tab), else the
 * global active task. An explicit `--tab` stays exact (on the dispatcher task); the dispatcher's own tab
 * is only the default.
 */
async function resolveSendTask(
  ctx: VerbContext,
  daemon: DaemonRpc,
  tab: string | undefined,
): Promise<{ taskId: string; tab: string | undefined }> {
  const explicit = ctx.args.str("task-id")
  if (explicit) return { taskId: explicit, tab }
  const dispatcher = await readOwnDispatcher(daemon)
  if (dispatcher) {
    return { taskId: dispatcher.taskId, tab: tab ?? (await resolveDispatcherTab(ctx.runtime, daemon, dispatcher)) }
  }
  const active = await resolveActiveTaskId(daemon)
  if (!active) {
    throw new ApiError("no --task-id given and no active task — open a task first or pass --task-id", "MISSING_TARGET")
  }
  return { taskId: active, tab }
}

export async function send(ctx: VerbContext): Promise<unknown> {
  if (ctx.args.str("tab") !== "new") return sendNow(ctx)
  // Whichever way the task is found, two new conversations on it are serialized.
  const { taskId } = await resolveSendTask(ctx, daemonOf(ctx), "new")
  return withFirstConversationLock(taskId, () => sendNow(ctx))
}

async function sendNow(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const prompt = requirePromptText(ctx, "send")
  let tab = ctx.args.str("tab")
  if (tab && tab !== "new" && !/^tab-[A-Za-z0-9-]+$/.test(tab)) {
    throw new ApiError(`--tab must be "new" or a tab id like tab-2 (got ${JSON.stringify(tab)})`, "BAD_TAB")
  }
  // A pinned engine only applies to the child `--tab new` creates; refuse rather than
  // hand a caller who asked for codex a claude conversation and a success exit.
  const tabCommand = ctx.args.str("command")
  if (tabCommand && tab !== "new") {
    throw new ApiError(
      `--command only applies to a new tab; pass --tab new (got --tab ${tab ?? "<canonical>"})`,
      "BAD_FLAG",
      helpStep("send"),
    )
  }
  const respawn = ctx.args.bool("respawn")
  // Exact-tab only: the canonical path already respawns a restored tab-1 and
  // `--tab new` spawns by definition, so the flag would be a silent no-op.
  if (respawn && (tab === undefined || tab === "new")) {
    throw new ApiError(
      `--respawn addresses one frozen tab; pass --tab tab-N (got --tab ${tab ?? "<canonical>"})`,
      "BAD_FLAG",
      helpStep("send"),
    )
  }
  const sendTo = await resolveSendTask(ctx, daemon, tab)
  let taskId = sendTo.taskId
  tab = sendTo.tab
  let res = await daemon.request<{ task: SerializedTask }>("task.get", { taskId })
  // Before ANY delivery path (--plain included: a verbatim false claim is the
  // same false claim) — a refused report must never reach the coordinator.
  await assertNotEmptySuccess(daemon, ctx, prompt)
  const requestedTaskId = taskId
  // `--tab new` is a new conversation: the task's own engine while it has none yet,
  // else a shared child whose own engine gets the prompt.
  let childTaskId: string | undefined
  let freshConversation = false
  if (tab === "new") {
    const home = await conversationHome(daemon, ctx.runtime, res.task, tabCommand, prompt)
    res = { task: home.task }
    freshConversation = true
    if (home.child) {
      childTaskId = home.task.id
      taskId = childTaskId
    }
    tab = undefined
  }
  // A migrated child's conversation is a hosted PTY keyed under its parent: its default tab IS that one,
  // delivered to exactly (a dead one is TAB_NOT_FOUND, never a second engine beside the live one).
  const alias = res.task.ptyAlias
  if (alias && tab === undefined) tab = alias.tabId
  // The same tab id under the parent names the child's conversation: not this task's to write into.
  if (tab && hostedKeyFor(taskId, tab, await ptyScopeOf(daemon, res.task)) === null) {
    throw new ApiError(`tab ${tab} on task ${taskId} belongs to a child task's conversation`, "TAB_NOT_FOUND", {
      taskId,
      tabId: tab,
      hint: "address the child itself with its own --task-id (`list` shows the lineage)",
      nextCommandArgs: ["api", "get-task", "--task-id", taskId],
    })
  }
  const plain = ctx.args.bool("plain") ? prompt : await withPeerProvenance(daemon, taskId, prompt)
  // Decision-gate answers the owner gave while this tab's engine was away (design § 3).
  // A fresh child is a different conversation: the answer stays owed to its own.
  const owed = childTaskId ? null : await takeOwedGateAnswers(daemon, taskId, tab)
  const withAnswers = owed ? `${owed.text}\n\n${plain}` : plain
  // Read BEFORE delivery: a paste into a failed session still "lands", and the
  // caller has to be told what it landed in.
  const target = childTaskId ? null : await activityView(await readActivityRegistry(daemon), res.task, tab)
  // Armed BEFORE the paste: a failed turn can fire its hook within
  // milliseconds of it, and an unarmed delivery can't be flagged missing.
  const expectReport = ctx.args.bool("expect-report") === true
  const pinnedTab = tab ? { tabId: tab } : {}
  // `--if-runnable`: the daemon decides, claims the tab and arms in one tick, so
  // two ticks arriving together cannot both pass. The claim is freed in `settle`.
  const admit = ctx.args.bool("if-runnable")
    ? await daemon.request<AdmitReply>("send.admit", {
        taskId,
        ...(tab ? { tabId: tab } : {}),
        ...(respawn ? { respawn } : {}),
        expectReport,
        promptHead: prompt,
      })
    : undefined
  if (admit?.skipped) {
    throw new ApiError(`not sent: ${admit.skipped.reason}`, "SKIPPED", {
      taskId,
      skipped: admit.skipped,
      ...(admit.deliveryId ? { deliveryId: admit.deliveryId } : {}),
    })
  }
  const claimId = admit?.claimId
  const armed = expectReport || res.task.requireReport === true
  const deliveryId = admit
    ? admit.deliveryId
    : armed
      ? (await daemon.request<{ deliveryId: string }>("delivery.arm", { taskId, ...pinnedTab, promptHead: prompt }))
          .deliveryId
      : undefined
  const text = deliveryId ? `${withAnswers}\n\n${deliveryFooter(deliveryId, roveApiInvocation())}` : withAnswers
  const settle = async (delivered: boolean, session?: string): Promise<void> => {
    if (claimId) await daemon.request("send.release", { claimId, delivered }).catch(() => {})
    // The hosted session key is `<taskId>::<tabId>`.
    const landedTab = session?.split("::")[1] ?? (tab && tab !== "new" ? tab : undefined)
    await recordSend(daemon, { taskId, tabId: landedTab, prompt, delivered, deliveryId })
    if (!deliveryId) return
    await daemon
      .request("delivery.settle", { deliveryId, delivered, ...(landedTab ? { tabId: landedTab } : {}) })
      .catch(() => {})
  }
  let delivered: Awaited<ReturnType<typeof ctx.runtime.deliverPrompt>>
  try {
    delivered = await ctx.runtime.deliverPrompt(
      daemon,
      {
        id: alias && tab === alias.tabId ? alias.taskId : taskId,
        worktreePath: taskCwd(res.task),
        kind: res.task.kind,
        vendor: res.task.vendor as VendorId | undefined,
        command: res.task.command,
        modelEffort: res.task.modelEffort,
        model: res.task.model,
        repo: res.task.repo,
        ...(res.task.extraRepos?.length || res.task.sharesWorkspaceOf ? { multiRepo: true } : {}),
        tab,
        respawn,
        ...(freshConversation && !childTaskId ? { firstConversation: true } : {}),
      },
      text,
    )
  } catch (err) {
    await settle(false)
    if (!childTaskId) throw err
    return failSharedChild(daemon, err, childTaskId, [
      "api",
      "send",
      "--task-id",
      requestedTaskId,
      "--tab",
      "new",
      ...(tabCommand ? ["--command", tabCommand] : []),
      "--plain",
      "--prompt",
      prompt,
    ])
  }
  // A prompt that never landed is a delivery FAILURE the script must see —
  // non-zero exit, not a phantom `ok:true`.
  if (!delivered.delivered) {
    // Cancel only when nothing was written: an unobserved launch may still start with the prompt.
    const mayLand = promptMayHaveLanded(delivered)
    await settle(mayLand, mayLand ? delivered.session : undefined)
    throw new ApiError(
      `prompt was not confirmed in ${taskId}'s engine (paste did not land)`,
      "NOT_DELIVERED",
      childTaskId ? { childTaskId } : undefined,
    )
  }
  await settle(true, delivered.session)
  // The answers rode this paste; only now are they the engine's.
  if (owed) await markGateAnswersDelivered(daemon, owed.gateIds)
  if (freshConversation) {
    // `.task.prompt` means "the engine was given exactly this text": recorded only once delivery confirmed.
    await daemon.request("task.setPrompt", { taskId, prompt }).catch((err: unknown) => {
      console.error(`[rove api send] task.setPrompt failed for ${taskId}:`, err)
    })
  }
  return {
    ok: true,
    taskId: requestedTaskId,
    ...(childTaskId ? { childTaskId } : {}),
    session: delivered.session,
    ...(deliveryId ? { deliveryId } : {}),
    started: delivered.started,
    engineReady: delivered.engineReady,
    // Measured delivery facts, spelled as `add` spells them.
    delivered: delivered.delivered,
    ...(delivered.bytes === undefined ? {} : { bytes: delivered.bytes }),
    ...(delivered.promptEcho ? { promptEcho: delivered.promptEcho } : {}),
    ...(delivered.reason ? { reason: delivered.reason } : {}), // see `DeliveredPrompt.reason`
    // This call reopened a frozen tab rather than delivering into a session
    // that was already running (`send --tab tab-N --respawn`).
    ...(delivered.respawned ? { respawned: true } : {}),
    // Conversations this call did NOT reach; only when a NEW session started,
    // where `delivered: true` would otherwise hide the frozen real ones. See
    // `DeliveredPrompt.frozenTabs`.
    ...(delivered.frozenTabs?.length ? { frozenTabs: delivered.frozenTabs } : {}),
    // The session was in `error`/`dead` when this prompt went in: `delivered`
    // only says the bytes landed, not that anything is there to act on them.
    ...(target && TARGET_FAILED.has(target.state)
      ? { targetState: target.state, ...(target.detail ? { targetDetail: target.detail } : {}) }
      : {}),
  }
}

const TARGET_FAILED = new Set(["error", "dead"])

/** `send.admit`: either the daemon refused the tick, or it claimed the tab (and armed a delivery when one is owed). */
interface AdmitReply {
  readonly skipped?: SkipVerdict
  readonly claimId?: string
  readonly deliveryId?: string
}

async function dispatch(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskId = ctx.args.require("task-id")
  const text = requirePromptText(ctx, "dispatch")
  const tabId = ctx.args.str("tab")
  // The sender, for the daemon's dispatch ledger.
  const self = await ownSession(daemon).catch(() => null)
  const reply = (await daemon.request("session.deliver", {
    taskId,
    text,
    ...(tabId !== undefined ? { tabId } : {}),
    source: "dispatcher",
    ...(self ? { fromTaskId: self.taskId, fromTabId: self.tabId } : {}),
  })) as { clients?: number; delivered?: boolean; reason?: string; layer?: string; tabId?: string } | undefined
  // `delivered: true` is OBSERVED (a paste landed in a live engine). `false`
  // means refused (busy composer) or broadcast, where `clients` is a raw
  // connection count including this CLI — only its zero proves nobody got it.
  // An older daemon omits `delivered`; absent stays absent.
  return {
    ok: true,
    taskId,
    ...(reply?.tabId !== undefined ? { tabId: reply.tabId } : tabId !== undefined ? { tabId } : {}),
    routed: "session.deliver",
    ...(reply?.delivered !== undefined ? { delivered: reply.delivered } : {}),
    ...(reply?.reason !== undefined ? { reason: reply.reason } : {}),
    ...(reply?.layer !== undefined ? { layer: reply.layer } : {}),
    ...(reply?.clients !== undefined ? { clients: reply.clients } : {}),
  }
}

/** Spec beside its handler: the flags and the code reading them change together. */
export const DISPATCH_VERB: VerbSpec = {
  name: "dispatch",
  group: "drive",
  summary:
    'Route text into a task\'s live session. The dispatcher\'s messenger (docs/design/dispatcher.md); unlike `send`, it never starts an engine — it requires an already-hosted session. The daemon pastes into it and reports `delivered`; `delivered:false` with `reason:"busy"` means a human is mid-message, and `reason:"broadcast"` means no hosted session answered and the text went out on the session.deliver channel for a browser to pick up (unconfirmable; `clients: 0` proves it reached nobody).',
  flags: [
    F.taskId(true),
    F.prompt(true, "Text delivered into the task's engine session."),
    F.promptFile(),
    {
      name: "tab",
      type: "string",
      required: false,
      placeholder: "TAB",
      description: "Deliver into exactly this tab (e.g. tab-3) instead of the canonical engine tab.",
    },
  ],
  handler: dispatch,
}

export async function note(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskId = ctx.args.require("task-id")
  const text = ctx.args.require("text")
  return await daemon.request("note.file", { taskId, text })
}

export async function getTask(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskId = ctx.args.require("task-id")
  const res = await daemon.request<{ task: SerializedTask }>("task.get", { taskId })
  // One liveness read serves both: `.running` (any live engine tab) and the
  // per-tab `.alive` an agent needs to pick a `send --tab tab-N` target.
  const { tabs, running } = await ctx.runtime.taskTabs(
    taskId,
    taskEngineArgv(res.task),
    await ptyScopeOf(daemon, res.task),
  )
  // The verdict a scheduler would act on, so a dashboard shows the same answer.
  const runnability = await readRunnability(daemon, taskId)
  return { task: res.task, running, tabs, ...(runnability ? { runnability } : {}) }
}

export async function list(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const local = await daemon.request<{ tasks: SerializedTask[] }>("task.list")
  // With no machine registered, returns the daemon's response untouched. A
  // transport caller gets this daemon's own tasks: a hub that forwarded the
  // call already merges, and fanning out again could loop back to it.
  const { mergeTaskList } = await import("../../machines/api-merge.ts")
  const all = ctx.caller.cli ? await mergeTaskList(local) : local
  // Archived tasks are hidden unless `--archived` asks for exactly them.
  const wantArchived = ctx.args.bool("archived") ?? false
  const merged = { ...all, tasks: (all.tasks ?? []).filter((task) => (task.archived === true) === wantArchived) }
  const filters = listFilters(ctx)
  const fields = listFields(ctx)
  const result = filters ? { ...merged, ...(await filterTaskList(ctx, daemon, merged.tasks ?? [], filters)) } : merged
  if (!result.tasks) return result
  // `.repoCount` (primary included) marks a multi-repo task; one-repo rows stay as they were.
  const tasks = result.tasks.map((t) => (t.extraRepos?.length ? { ...t, repoCount: t.extraRepos.length + 1 } : t))
  return { ...result, tasks: fields ? projectTasks(tasks, fields) : tasks }
}

export async function setActive(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const none = ctx.args.bool("none")
  const taskId = none ? null : ctx.args.require("task-id")
  await daemon.request("task.setActive", { taskId })
  return { ok: true, activeTaskId: taskId }
}
