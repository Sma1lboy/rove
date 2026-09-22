/**
 * Verb handlers for task reads, prompt delivery and issue-update — the
 * `read` / `drive` / `edit` verbs that aren't a one-line `simpleRpc` in the
 * {@link VERBS} table. Task-ending verbs (with their teardown recovery) live
 * in `handlers-lifecycle.ts`.
 */

import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { resolveCommandProtocol } from "../../engine/engine-presets.ts"
import type { VendorId } from "../../types/vendor.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { readOwnDispatcher, resolveDispatcherTab, verifiedSelfSession, withPeerProvenance } from "./dispatcher.ts"
import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { resolveActiveTaskId } from "./runtime.ts"
import { taskEngineArgv } from "./tab-snapshot.ts"
import { ApiError, type VerbContext, type VerbSpec, helpStep } from "./types.ts"

export async function issueUpdate(ctx: VerbContext): Promise<unknown> {
  const title = ctx.args.str("title")
  const body = ctx.args.str("body")
  const task = ctx.args.str("task")
  if (title === undefined && body === undefined && task === undefined) {
    throw new ApiError("issue-update requires --title, --body, and/or --task", "MISSING_FLAG")
  }
  const repoRoot = ctx.args.requireRepo("repo")
  const id = ctx.args.int("id")
  // ONE mutate, so `--title X --task <bogus>` can't half-run: the store
  // applies all three fields under one lock, and the daemon's task-existence
  // check runs before it, so a rejected link writes nothing.
  //
  // `--task none` unlinks (carried as `taskId: null`); anything else links.
  // Linking IS the kanban move to In progress — the board column derives from
  // the link, not a stored column.
  const link = task === undefined ? {} : { taskId: task === "none" ? null : task }
  return simpleRpc(ctx, "issue.mutate", { repoRoot, op: { type: "update", id, title, body, ...link } })
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

export async function send(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const prompt = requirePromptText(ctx, "send")
  let tab = ctx.args.str("tab")
  if (tab && tab !== "new" && !/^tab-[A-Za-z0-9-]+$/.test(tab)) {
    throw new ApiError(`--tab must be "new" or a tab id like tab-2 (got ${JSON.stringify(tab)})`, "BAD_TAB")
  }
  // A pinned engine only applies to a tab being CREATED; refuse rather than
  // hand a caller who asked for codex a claude tab and a success exit.
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
  // Protocol resolution happens HERE, in the CLI, because the preset
  // registry lives in kobe's state.json — the same tier-(a) read `add` does.
  const tabVendor = tabCommand ? resolveCommandProtocol(tabCommand) : undefined
  let taskId = ctx.args.str("task-id")
  if (!taskId) {
    // Inside a sub-task a bare `send` replies to its DISPATCHER (task + tab),
    // not the global active task. An explicit --tab stays exact (on the
    // dispatcher task); the fallback chain only runs for the tab default.
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
      model: tabCommand ? undefined : res.task.model,
      repo: res.task.repo,
      tab,
      tabVendor,
      tabCommand,
      respawn,
    },
    text,
  )
  // A prompt that never landed is a delivery FAILURE the script must see —
  // non-zero exit, not a phantom `ok:true`.
  if (!delivered.delivered) {
    throw new ApiError(`prompt was not confirmed in ${taskId}'s engine (paste did not land)`, "NOT_DELIVERED")
  }
  return {
    ok: true,
    taskId,
    session: delivered.session,
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
  const { tabs, running } = await ctx.runtime.taskTabs(taskId, taskEngineArgv(res.task))
  return { task: res.task, running, tabs }
}

export async function list(ctx: VerbContext): Promise<unknown> {
  const local = await daemonOf(ctx).request<{ tasks: SerializedTask[] }>("task.list")
  // With no machine registered, returns the daemon's response untouched.
  const { mergeTaskList } = await import("../../machines/api-merge.ts")
  return await mergeTaskList(local)
}

export async function setActive(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const none = ctx.args.bool("none")
  const taskId = none ? null : ctx.args.require("task-id")
  await daemon.request("task.setActive", { taskId })
  return { ok: true, activeTaskId: taskId }
}
