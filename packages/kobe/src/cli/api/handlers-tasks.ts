/**
 * Verb handlers for task CRUD + prompt delivery + issue-update — the
 * `read` / `create` / `drive` / `edit` / `lifecycle` / `worktree` groups
 * that aren't a one-line `simpleRpc` inline in the {@link VERBS} table.
 * Split out of `api-cmd.ts` (see that file's header).
 */

import { errorMessage } from "@/lib/error-message"
import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { resolveCommandProtocol } from "../../engine/engine-presets.ts"
import { kobeApiInvocation } from "../../engine/interactive-command.ts"
import { EMPTY_BRANCH_DIRTY_WORKTREE_CODE } from "../../orchestrator/errors.ts"
import type { VendorId } from "../../types/vendor.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { readOwnDispatcher, resolveDispatcherTab, verifiedSelfSession } from "./dispatcher.ts"
import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { resolveActiveTaskId } from "./runtime.ts"
import { ApiError, type VerbContext, type VerbSpec, helpStep } from "./types.ts"

/**
 * Peer provenance: a `send` issued from INSIDE another kobe task is one
 * agent messaging another, and the receiver needs what a bare paste never
 * carries — who is talking and how to answer. Same convention as field
 * notes (`[ROVE FIELD NOTE] from "<label>" (task <id>)`), plus the reply
 * command so a peer conversation is symmetric without any coordinator.
 * Sender identity is the VERIFIED $KOBE_TASK_ID/$KOBE_TAB_ID pair, not the
 * raw env: an unverified one names a stranger's session as the sender and
 * bakes their tab into the reply command (issue #24). A send from a plain
 * shell, an unverified process, or to yourself stays untouched.
 */
async function withPeerProvenance(daemon: DaemonRpc, targetTaskId: string, prompt: string): Promise<string> {
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
  // (issue #21): task-granular replies land on canonical-tab resolution,
  // which is exactly the link that breaks (#19) — tab-precise addressing is
  // the loop's durable route home. $KOBE_TAB_ID is exported into every
  // engine tab alongside $KOBE_TASK_ID (session-launch.ts).
  const replyTarget = `--task-id ${senderId} --tab ${self.tabId}`
  // The trailing pointer closes the loop for a receiver that has never seen
  // kobe: reply command baked in, and where to learn the rest (the herdr
  // "--skill first" trick) — a pointer, not a curriculum, since every peer
  // message pays for this prefix in context. Loading the skill is REQUIRED,
  // not suggested: a receiver that replies from the raw prefix alone
  // improvises verbs and side-channels (2026-08-10: a peer coordination
  // round-trip fell back to a human relay because neither side had the
  // skill's contract in context).
  // The sender's text goes LAST, whole, after a blank line — never as the
  // object of this English sentence. A model generates in the language of
  // the tokens nearest its turn, so wrapping a Chinese prompt in an English
  // clause pulled replies into English; ending on the sender's own words
  // removes that pull without changing what the prefix says.
  return `[ROVE PEER] from "${label}" (task ${senderId} — load the Rove agent skill FIRST (registered as /rove; legacy /kobe installs still work), then reply: \`${api} send ${replyTarget} --prompt "<text>"\`; verb reference: \`${api} schema\`)\n\n${prompt}`
}

export async function issueUpdate(ctx: VerbContext): Promise<unknown> {
  const title = ctx.args.str("title")
  const body = ctx.args.str("body")
  const task = ctx.args.str("task")
  if (title === undefined && body === undefined && task === undefined) {
    throw new ApiError("issue-update requires --title, --body, and/or --task", "MISSING_FLAG")
  }
  const repoRoot = ctx.args.requirePath("repo")
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
    ahead = (await ctx.runtime.readBranchSignals(sender.worktreePath)).ahead
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
      nextCommandArgs: ["api", "send", "--allow-empty", "--prompt", prompt],
    },
  )
}

export async function send(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const prompt = ctx.args.require("prompt")
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
    },
    text,
  )
  // A prompt that never landed AND was not deferred is a delivery FAILURE the
  // script must see — non-zero exit, not a phantom `ok:true`. Deferred
  // (issue #78 B-layer) is a SUCCESS: the daemon owns the message and queued
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
    ...(delivered.deferred
      ? {
          deferred: delivered.deferred,
          // The deferred outcome is a SUCCESS, not an error — say so explicitly
          // so a scripted sender does not read `deferred` as a failure and retry.
          delivered: false,
        }
      : {}),
  }
}

export async function dispatch(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskId = ctx.args.require("task-id")
  const text = ctx.args.require("prompt")
  const tabId = ctx.args.str("tab")
  const reply = (await daemon.request("session.deliver", {
    taskId,
    text,
    ...(tabId !== undefined ? { tabId } : {}),
    source: "dispatcher",
  })) as { clients?: number } | undefined
  // Surface the daemon's reach verdict. `session.deliver` is broadcast-only
  // (an attached client performs the paste), so `clients: 0` means the text
  // reached nobody — the caller must not read `ok` as "the engine saw it".
  // An older daemon omits the field; absent stays absent rather than being
  // guessed either way.
  return {
    ok: true,
    taskId,
    ...(tabId !== undefined ? { tabId } : {}),
    routed: "session.deliver",
    ...(reply?.clients !== undefined ? { clients: reply.clients } : {}),
  }
}

/** The verb spec lives beside its handler (PANE_VERB pattern) so verbs.ts
 *  stays under the file-size cap. */
export const DISPATCH_VERB: VerbSpec = {
  name: "dispatch",
  summary:
    "Route text into a task's live session via the daemon's session.deliver channel. The dispatcher's messenger (docs/design/dispatcher.md); unlike `send`, it requires an already-hosted session.",
  flags: [
    F.taskId(true),
    F.prompt(true, "Text delivered into the task's engine session."),
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
  const { tabs, running } = await ctx.runtime.taskTabs(taskId)
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

export async function deleteTask(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskId = ctx.args.require("task-id")
  const force = ctx.args.bool("force") ?? false
  // Branch deletion is opt-in (same flag as `land`): delete drops the
  // worktree + task entry, git keeps the branch as the durable record.
  const deleteBranch = ctx.args.bool("delete-branch") ?? false
  // Deleting somebody else's task destroys their worktree and every tab in
  // it, so the daemon's audit line has to name WHO asked. Same verified
  // identity `send`/`add` use (never the bare env — issue #24): unverifiable
  // stays unattributed rather than blaming a stranger's session.
  const self = await verifiedSelfSession()
  const res = await daemon.request("task.delete", {
    taskId,
    force,
    deleteBranch,
    ...(self ? { requestedByTaskId: self.taskId, requestedByTabId: self.tabId } : {}),
  })
  // The daemon's task.delete removes the worktree + index entry but never the
  // hosted session. Without this, a scripted delete
  // orphans the `kobe-<id>` session + its engine — invisible to every kobe UI
  // since the task is gone from tasks.json. Mirror the TUI's finishDeletedTaskFlow
  // and kill it here, after the delete RPC succeeds.
  await ctx.runtime.tearDownSession(taskId)
  return res
}

export async function land(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskId = ctx.args.require("task-id")
  const strategy = ctx.args.str("strategy") === "squash" ? "squash" : "merge"
  let res: { result: unknown }
  try {
    res = await daemon.request<{ result: unknown }>("task.land", {
      taskId,
      strategy,
      deleteBranch: ctx.args.bool("delete-branch") ?? false,
      // Left UNDEFINED when the flag is absent so the orchestrator's default
      // (remove it) applies; only an explicit `--remove-worktree=false` keeps
      // the worktree. Coercing undefined to false here would pin the CLI to
      // the old opt-in behaviour.
      removeWorktree: ctx.args.bool("remove-worktree"),
      // Sent on EVERY land: the daemon refuses to remove the worktree the
      // caller is running from, and it can only know where that is if we tell
      // it. Since removal is now the default rather than an opt-in flag, an
      // agent landing its own task would otherwise delete its own cwd.
      callerCwd: process.cwd(),
    })
  } catch (err) {
    throw landRecoveryError(err, taskId)
  }
  return { ok: true, taskId, ...(res.result as object) }
}

/**
 * Give EMPTY_BRANCH_DIRTY_WORKTREE an executable recovery path (the
 * self-healing `hint` + `nextCommandArgs` convention, same shape as
 * TASK_NOT_FOUND): the worker WROTE its work but never committed it, so the
 * recovery is a `send` back to THAT worker telling it to commit its own work
 * with its own message — never an auto-commit here, the commit message
 * belongs to whoever did the work. The branch name rides the daemon's error
 * message (only the message survives the RPC wire), so it is lifted back out
 * for the prompt. The clean-worktree variant (EMPTY_BRANCH) deliberately
 * gets NO recovery path: "worker reported success but delivered nothing" is
 * a signal a human must look at, not something to auto-retry.
 */
function landRecoveryError(err: unknown, taskId: string): unknown {
  const message = errorMessage(err)
  if (!message.includes(EMPTY_BRANCH_DIRTY_WORKTREE_CODE)) return err
  const branch = /EMPTY_BRANCH_DIRTY_WORKTREE: '([^']+)'/.exec(message)?.[1] ?? "your task branch"
  return new ApiError(message, EMPTY_BRANCH_DIRTY_WORKTREE_CODE, {
    hint: "the worker wrote files but never committed them — send it back to commit its own work, then land again",
    nextCommandArgs: [
      "api",
      "send",
      "--task-id",
      taskId,
      "--prompt",
      `your work is uncommitted on ${branch} — commit it yourself with a proper message, then report back`,
    ],
  })
}

export async function adopt(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const { args } = ctx
  const input: Record<string, string> = {
    repo: args.requirePath("repo"),
    worktreePath: args.requirePath("worktree"),
  }
  const branch = args.str("branch")
  if (branch) input.branch = branch
  const command = args.str("command")
  if (command) {
    input.command = command
    input.vendor = resolveCommandProtocol(command)
  }
  const title = args.str("title")
  if (title) input.title = title
  return daemon.request<{ task: SerializedTask }>("worktree.adopt", input)
}
