/**
 * Verb handlers for task reads, prompt delivery and issue-update — the
 * `read` / `drive` / `edit` groups that aren't a one-line `simpleRpc` inline
 * in the {@link VERBS} table. Split out of `api-cmd.ts` (see that file's
 * header).
 *
 * The `lifecycle` group (delete / land / adopt) lives in
 * `handlers-lifecycle.ts`: those verbs END a task and each owns a recovery
 * story for a half-finished teardown, which is a different failure mode from
 * "the prompt did not land" and moves on a different schedule.
 */

import { errorMessage } from "@/lib/error-message"
import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { resolveCommandProtocol } from "../../engine/engine-presets.ts"
import { kobeApiInvocation } from "../../engine/interactive-command.ts"
import { DIRTY_WORKTREE_CODE, EMPTY_BRANCH_DIRTY_WORKTREE_CODE } from "../../orchestrator/errors.ts"
import type { VendorId } from "../../types/vendor.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { readOwnDispatcher, resolveDispatcherTab, verifiedSelfSession, withPeerProvenance } from "./dispatcher.ts"
import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { resolveActiveTaskId } from "./runtime.ts"
import { taskEngineArgv } from "./tab-snapshot.ts"
import { ApiError, type VerbContext, type VerbSpec, helpStep, splitDaemonCode } from "./types.ts"

export async function issueUpdate(ctx: VerbContext): Promise<unknown> {
  const title = ctx.args.str("title")
  const body = ctx.args.str("body")
  const task = ctx.args.str("task")
  if (title === undefined && body === undefined && task === undefined) {
    throw new ApiError("issue-update requires --title, --body, and/or --task", "MISSING_FLAG")
  }
  const repoRoot = ctx.args.requireRepo("repo")
  const id = ctx.args.int("id")
  let result: unknown
  if (title !== undefined || body !== undefined) {
    result = await simpleRpc(ctx, "issue.mutate", { repoRoot, op: { type: "update", id, title, body } })
  }
  if (task !== undefined) {
    // `--task none` unlinks; anything else links. Linking IS the kanban move to
    // In progress — the board column derives from the link, not a stored column.
    const op = task === "none" ? { type: "unlink", id } : { type: "link", id, taskId: task }
    result = await simpleRpc(ctx, "issue.mutate", { repoRoot, op })
  }
  return result
}

/**
 * Refuse a `succeeded:` report from a worker whose branch carries no commits.
 *
 * `send` is where a completion CLAIM enters the system, and until now it was
 * the one hop that never looked at the claim. The contradiction was already
 * detectable AT THAT MOMENT — the sender's worktree is on disk and
 * `readBranchSignals` is a lock-free read `collect` already makes — but the
 * only thing that ever checked was `land`'s EMPTY_BRANCH, two steps later,
 * after the coordinator had believed the report and possibly archived the
 * siblings. The check was in the right codebase at the wrong end of the loop.
 *
 * Scope is deliberately narrow, because a false NEGATIVE here is cheap and a
 * false POSITIVE blocks a worker from reporting at all:
 *   - only a VERIFIED self session (the same identity `send` already trusts
 *     for dispatcher routing) — an unverified env names a stranger's branch;
 *   - only a MANAGED task: `main`/`dir` tasks have no Rove-created branch, and
 *     an agent on a main checkout legitimately reads `ahead: 0`;
 *   - only a DEFINITE `ahead === 0`. An unresolvable base reads null — an
 *     honest unknown, never grounds to refuse.
 *
 * And it is a refusal WITH an exit, not a wall: investigation and review tasks
 * genuinely succeed with no commits, so `--allow-empty` states that outright
 * (the `git commit --allow-empty` spelling, same meaning). What the guard
 * removes is the ACCIDENTAL empty success — the one that shipped as a clean
 * report — not the deliberate one.
 */
async function assertNotEmptySuccess(daemon: DaemonRpc, ctx: VerbContext, prompt: string): Promise<void> {
  if (ctx.args.bool("allow-empty")) return
  // The fullwidth colon is not a typo — an agent writing Chinese types
  // `succeeded：` from a CJK IME without noticing, and matching only U+003A
  // would let exactly the reports this repo's agents write walk past.
  if (!/^\s*succeeded\s*[:\uff1a]/i.test(prompt)) return
  const self = await verifiedSelfSession()
  if (!self) return
  let sender: SerializedTask
  try {
    sender = (await daemon.request<{ task: SerializedTask }>("task.get", { taskId: self.taskId })).task
  } catch {
    return // stale id / unreadable task — an unknown is never grounds to refuse
  }
  if (sender.kind === "main" || sender.kind === "dir") return
  if (!sender.worktreePath) return
  // Every failure mode here is an UNKNOWN, and the rule this guard states for
  // itself is that an unknown never refuses — so a read that throws delivers,
  // exactly like the `ahead: null` it returns for an unresolvable base.
  let ahead: number | null
  try {
    // Paired with `collect`'s read in handlers-fanout.ts: both measure against
    // the task's RECORDED base (`add --base-branch`), never the origin/main
    // guess. Reading against the guess produced BOTH failure modes at once on
    // a task cut from `release/2.x` two commits ahead of `main`: an empty
    // branch read `ahead: 2` (the guard let a hollow success through), and a
    // HEAD behind the guessed base read a false positive — the exact
    // "false POSITIVE blocks a worker" case the paragraph above warns against.
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
      // Carry the caller's own target forward. The hint tells the agent to run
      // this verbatim, and without the flags the retry re-resolves through the
      // active-task fallback — so an explicit `send --task-id X` could retry
      // into a DIFFERENT task than the one it addressed.
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

export async function send(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const prompt = requirePromptText(ctx, "send")
  let tab = ctx.args.str("tab")
  if (tab && tab !== "new" && !/^tab-[A-Za-z0-9-]+$/.test(tab)) {
    throw new ApiError(`--tab must be "new" or a tab id like tab-2 (got ${JSON.stringify(tab)})`, "BAD_TAB")
  }
  // A pinned engine only means something on a tab being CREATED: an alive
  // tab already runs whatever it runs, and the canonical tab belongs to the
  // task's own engine. Refuse rather than silently ignore — a caller that
  // asked for codex must not get claude and a success exit.
  const tabCommand = ctx.args.str("command")
  if (tabCommand && tab !== "new") {
    throw new ApiError(
      `--command only applies to a new tab; pass --tab new (got --tab ${tab ?? "<canonical>"})`,
      "BAD_FLAG",
      helpStep("send"),
    )
  }
  const respawn = ctx.args.bool("respawn")
  // Reviving is an exact-tab act: the canonical path already respawns a
  // restored tab-1 on its own (it is the tab it would create), and `--tab
  // new` spawns by definition. Refuse rather than accept a flag that would
  // do nothing — a caller asking to revive tab-2 must not get a silent no-op.
  if (respawn && (tab === undefined || tab === "new")) {
    throw new ApiError(
      `--respawn addresses one frozen tab; pass --tab tab-N (got --tab ${tab ?? "<canonical>"})`,
      "BAD_FLAG",
      helpStep("send"),
    )
  }
  // Protocol resolution happens HERE, in the CLI, because the preset
  // registry lives in kobe's state.json — the same tier-(a) read `add` does.
  const tabVendor = tabCommand ? resolveCommandProtocol(tabCommand) : undefined
  let taskId = ctx.args.str("task-id")
  if (!taskId) {
    // Inside a sub-task, a bare `send` is the reply verb: it defaults to the
    // DISPATCHER (task + tab) that created this task, not the global active
    // task — the loop's outcome contract (55c990f34) routes completion back
    // to the dispatching chat tab. An explicit --tab keeps its exact-tab
    // semantics (on the dispatcher task); the fallback chain only runs for
    // the tab default.
    const dispatcher = await readOwnDispatcher(daemon)
    if (dispatcher) {
      taskId = dispatcher.taskId
      if (tab === undefined) tab = await resolveDispatcherTab(ctx.runtime, dispatcher)
    } else {
      const active = await resolveActiveTaskId(daemon)
      if (!active) {
        throw new ApiError(
          "no --task-id given and no active task — open a task first or pass --task-id",
          "MISSING_TARGET",
        )
      }
      taskId = active
    }
  }
  const res = await daemon.request<{ task: SerializedTask }>("task.get", { taskId })
  // Before ANY delivery path (--plain included: a verbatim false claim is the
  // same false claim) — a refused report must never reach the coordinator.
  await assertNotEmptySuccess(daemon, ctx, prompt)
  const text = ctx.args.bool("plain") ? prompt : await withPeerProvenance(daemon, taskId, prompt)
  const delivered = await ctx.runtime.deliverPrompt(
    daemon,
    {
      id: taskId,
      worktreePath: res.task.worktreePath,
      kind: res.task.kind,
      // The pinned engine wins for THIS delivery's argv; the task's own
      // command/protocol stays untouched (a second agent in the worktree is
      // not a change of the task's engine).
      vendor: res.task.vendor as VendorId | undefined,
      command: res.task.command,
      modelEffort: tabCommand ? undefined : res.task.modelEffort,
      repo: res.task.repo,
      tab,
      tabVendor,
      tabCommand,
      respawn,
    },
    text,
  )
  // A prompt that never landed AND was not deferred is a delivery FAILURE the
  // script must see — non-zero exit, not a phantom `ok:true`. A deferred
  // prompt is a SUCCESS: the daemon owns the message and queued
  // an inbox episode. The caller must NOT retry — a retry would stack a
  // duplicate of the same message in the deferred queue.
  if (!delivered.delivered && !delivered.deferred) {
    throw new ApiError(`prompt was not confirmed in ${taskId}'s engine (paste did not land)`, "NOT_DELIVERED")
  }
  return {
    ok: true,
    taskId,
    session: delivered.session,
    started: delivered.started,
    engineReady: delivered.engineReady,
    // The measured delivery facts, spelled the same way `add` spells them
    // (handlers-add.ts) — `send` used to compute them and throw them away, so
    // a successful send omitted `delivered` entirely while a deferred one
    // reported it as the only outcome field.
    delivered: delivered.delivered,
    ...(delivered.bytes === undefined ? {} : { bytes: delivered.bytes }),
    ...(delivered.promptEcho ? { promptEcho: delivered.promptEcho } : {}),
    ...(delivered.reason ? { reason: delivered.reason } : {}), // see `DeliveredPrompt.reason`
    // The deferred outcome is a SUCCESS, not an error — say so explicitly so a
    // scripted sender does not read `deferred` as a failure and retry.
    ...(delivered.deferred ? { deferred: delivered.deferred } : {}),
    // This call reopened a frozen tab rather than delivering into a session
    // that was already running (`send --tab tab-N --respawn`).
    ...(delivered.respawned ? { respawned: true } : {}),
    // The conversations this call did NOT reach. Only present when a NEW
    // session was started, which is the branch where `started/delivered:
    // true` plus `running: true` reads as "your message reached the agent"
    // while the task's real conversations sit frozen. See
    // `DeliveredPrompt.frozenTabs`.
    ...(delivered.frozenTabs?.length ? { frozenTabs: delivered.frozenTabs } : {}),
  }
}

async function dispatch(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskId = ctx.args.require("task-id")
  const text = requirePromptText(ctx, "dispatch")
  const tabId = ctx.args.str("tab")
  const reply = (await daemon.request("session.deliver", {
    taskId,
    text,
    ...(tabId !== undefined ? { tabId } : {}),
    source: "dispatcher",
  })) as { clients?: number; delivered?: boolean; reason?: string; layer?: string; tabId?: string } | undefined
  // Surface the daemon's own verdict. `delivered: true` is OBSERVED — a paste
  // landed in a live engine session. `false` is not: the daemon either
  // refused (a busy composer) or fell back to the broadcast, where `clients`
  // is a raw CONNECTION count (the calling CLI is one of them) and only its
  // zero is proof — the text reached nobody. An older daemon omits `delivered`
  // entirely; absent stays absent rather than being guessed either way.
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

/** The verb spec lives beside its handler (PANE_VERB pattern): the flag list
 *  and the code that reads those flags change together, so they stay in one
 *  file and `verbs.ts` imports the finished spec. */
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
  const { tabs, running } = await ctx.runtime.taskTabs(taskId, taskEngineArgv(res.task))
  return { task: res.task, running, tabs }
}

export async function list(ctx: VerbContext): Promise<unknown> {
  return daemonOf(ctx).request<{ tasks: SerializedTask[] }>("task.list")
}

export async function setActive(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const none = ctx.args.bool("none")
  const taskId = none ? null : ctx.args.require("task-id")
  await daemon.request("task.setActive", { taskId })
  return { ok: true, activeTaskId: taskId }
}
