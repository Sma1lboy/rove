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
import {
  noReplyAddress,
  ownSession,
  readOwnDispatcher,
  recordSend,
  resolveDispatcherTab,
  withPeerProvenance,
} from "./dispatcher.ts"
import { assertNotEmptySuccess } from "./empty-success-guard.ts"
import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { markGateAnswersDelivered, takeOwedGateAnswers } from "./handlers-gates.ts"
import { assertQueueFlags, queueIfBusy } from "./handlers-queue.ts"
import { readRunnability } from "./handlers-runnability.ts"
import { handoffBrief } from "./handoff-brief.ts"
import { replaceDeadTab } from "./handoff-replace.ts"
import { filterTaskList, listFields, listFilters, projectTasks } from "./list-filter.ts"
import { ptyScopeOf } from "./pty-scope.ts"
import { resolveActiveTaskId } from "./runtime.ts"
import { awaitingChoiceError, tabsAwaitingChoice } from "./send-menu-guard.ts"
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

/** `--prompt` or `--prompt-file`, and one of them must be there. */
export function requirePromptText(ctx: VerbContext, verb: string): string {
  const text = ctx.args.promptText()
  if (text === undefined) throw new ApiError("--prompt (or --prompt-file) is required", "MISSING_FLAG", helpStep(verb))
  return text
}

/**
 * The task a send goes to: `--task-id`, else — inside a rove session — its DISPATCHER (task + tab), else the
 * global active task. An explicit `--tab` stays exact (on the dispatcher task); the dispatcher's own tab
 * is only the default. A rove session with no dispatcher is refused rather than sent to the active task.
 */
async function resolveSendTask(
  ctx: VerbContext,
  daemon: DaemonRpc,
  tab: string | undefined,
): Promise<{ taskId: string; tab: string | undefined }> {
  const explicit = ctx.args.str("task-id")
  if (explicit) return { taskId: explicit, tab }
  const own = await readOwnDispatcher(daemon)
  if (own?.dispatcher) {
    const { dispatcher } = own
    return { taskId: dispatcher.taskId, tab: tab ?? (await resolveDispatcherTab(ctx.runtime, daemon, dispatcher)) }
  }
  if (own) throw noReplyAddress(own.self)
  const active = await resolveActiveTaskId(daemon)
  if (!active) {
    throw new ApiError("no --task-id given and no active task — open a task first or pass --task-id", "MISSING_TARGET")
  }
  return { taskId: active, tab }
}

/** Taking back a dead-tab replacement whose handoff did not complete (`handoff-replace.ts`). */
interface ReplaceRollback {
  undo?: () => Promise<void>
}

export async function send(ctx: VerbContext): Promise<unknown> {
  const rollback: ReplaceRollback = {}
  try {
    return await sendNow(ctx, rollback)
  } catch (err) {
    await rollback.undo?.().catch(() => {})
    throw err
  }
}

async function sendNow(ctx: VerbContext, rollback: ReplaceRollback): Promise<unknown> {
  const daemon = daemonOf(ctx)
  let tab = ctx.args.str("tab")
  if (tab === "new") {
    const parent = ctx.args.str("task-id")
    const command = ctx.args.str("command")
    const text = ctx.args.promptText()
    throw new ApiError(
      "send delivers into a conversation that exists; start a new one in the same directory with `add --no-worktree`",
      "BAD_TAB",
      {
        hint: "`add --no-worktree` nests under the calling session, or under --parent ID",
        nextCommandArgs: [
          "api",
          "add",
          ...(parent ? ["--parent", parent] : []),
          "--no-worktree",
          ...(command ? ["--command", command] : []),
          ...(text ? ["--prompt", text] : []),
        ],
      },
    )
  }
  if (tab && !/^tab-[A-Za-z0-9-]+$/.test(tab)) {
    throw new ApiError(`--tab must be a tab id like tab-2 (got ${JSON.stringify(tab)})`, "BAD_TAB")
  }
  const replace = ctx.args.bool("replace") === true
  if (replace && !tab) {
    throw new ApiError("--replace takes over one dead tab; pass --tab tab-N", "BAD_FLAG", helpStep("send"))
  }
  // A pinned engine only applies to the tab `--replace` takes over; refuse rather than
  // hand a caller who asked for codex a claude conversation and a success exit.
  const tabCommand = ctx.args.str("command")
  if (tabCommand && !replace) {
    throw new ApiError(
      "--command names the engine that takes over a dead tab; pass --tab tab-N --replace (another engine in a new conversation is `add --no-worktree --command`)",
      "BAD_FLAG",
      helpStep("send"),
    )
  }
  // With --replace the prompt is optional: the brief already asks the engine to say where the work stood.
  let prompt = replace ? (ctx.args.promptText() ?? "") : requirePromptText(ctx, "send")
  const respawn = ctx.args.bool("respawn")
  assertQueueFlags(ctx)
  // Exact-tab only: the canonical path already respawns a restored tab-1, so the flag would be a silent no-op.
  if (respawn && tab === undefined) {
    throw new ApiError(
      "--respawn addresses one frozen tab; pass --tab tab-N (got --tab <canonical>)",
      "BAD_FLAG",
      helpStep("send"),
    )
  }
  const sendTo = await resolveSendTask(ctx, daemon, tab)
  const taskId = sendTo.taskId
  tab = sendTo.tab
  const res = await daemon.request<{ task: SerializedTask }>("task.get", { taskId })
  if (replace && tab) prompt = [await handoffBrief(ctx, res.task, tab, "send"), prompt].filter(Boolean).join("\n\n")
  // Before ANY delivery path (--plain included: a verbatim false claim is the
  // same false claim) — a refused report must never reach the coordinator.
  await assertNotEmptySuccess(daemon, ctx, prompt)
  let replacedTab: string | undefined
  if (replace && tab) {
    // A dead tab's slot is the new engine's: same task and tab, no child (docs/SESSIONS.md).
    rollback.undo = await replaceDeadTab({ runtime: ctx.runtime, daemon }, res.task, tab, tabCommand)
    replacedTab = tab
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
  // `--queue` on a busy tab: the daemon holds it until the turn ends, so owed gate answers stay owed too.
  const held = await queueIfBusy(ctx, daemon, res.task, tab, plain)
  if (held) return held
  // Read BEFORE delivery: a paste into a failed session still "lands", and the
  // caller has to be told what it landed in.
  const target = await activityView(await readActivityRegistry(daemon), res.task, tab)
  const waiting = await tabsAwaitingChoice(daemon, taskId, tab, target)
  if (waiting) throw awaitingChoiceError(taskId, waiting)
  // Decision-gate answers the owner gave while this tab's engine was away (design § 3).
  const owed = await takeOwedGateAnswers(daemon, taskId, tab)
  const withAnswers = owed ? `${owed.text}\n\n${plain}` : plain
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
    const landedTab = session?.split("::")[1] ?? tab
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
      },
      text,
    )
  } catch (err) {
    await settle(false)
    throw err
  }
  // A prompt that never landed is a delivery FAILURE the script must see —
  // non-zero exit, not a phantom `ok:true`.
  if (!delivered.delivered) {
    // Cancel only when nothing was written: an unobserved launch may still start with the prompt.
    const mayLand = promptMayHaveLanded(delivered)
    // A paste that may have landed is the new engine's now; only a clean miss gives the tab back.
    if (mayLand) rollback.undo = undefined
    await settle(mayLand, mayLand ? delivered.session : undefined)
    throw new ApiError(`prompt was not confirmed in ${taskId}'s engine (paste did not land)`, "NOT_DELIVERED")
  }
  await settle(true, delivered.session)
  // The answers rode this paste; only now are they the engine's.
  if (owed) await markGateAnswersDelivered(daemon, owed.gateIds)
  return {
    ok: true,
    taskId,
    ...(replacedTab ? { replacedTab } : {}),
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
