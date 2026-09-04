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
import { DIRTY_WORKTREE_CODE, EMPTY_BRANCH_DIRTY_WORKTREE_CODE } from "../../orchestrator/errors.ts"
import type { VendorId } from "../../types/vendor.ts"
import type { DaemonRpc } from "../daemon-session.ts"
import { readOwnDispatcher, resolveDispatcherTab, verifiedSelfSession, withPeerProvenance } from "./dispatcher.ts"
import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { resolveActiveTaskId } from "./runtime.ts"
import { taskEngineArgv } from "./tab-snapshot.ts"
import { ApiError, type VerbContext, type VerbSpec, helpStep, splitDaemonCode } from "./types.ts"

/** How long `delete --wait` follows a deletion before reporting `pending`.
 *  A worktree teardown is filesystem-bound; this is generous headroom, not a
 *  deadline the deletion itself respects. */
const DELETE_WAIT_TIMEOUT_MS = 60_000
const DELETE_POLL_INTERVAL_MS = 250

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
    // The deferred outcome is a SUCCESS, not an error — say so explicitly so a
    // scripted sender does not read `deferred` as a failure and retry.
    ...(delivered.deferred ? { deferred: delivered.deferred } : {}),
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

export async function deleteTask(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskId = ctx.args.require("task-id")
  const force = ctx.args.bool("force") ?? false
  // Branch deletion is opt-in (same flag as `land`): delete drops the
  // worktree + task entry, git keeps the branch as the durable record.
  const deleteBranch = ctx.args.bool("delete-branch") ?? false
  // Deleting somebody else's task destroys their worktree and every tab in
  // it, so the daemon's audit line has to name WHO asked. Same verified
  // identity `send`/`add` use, never the bare env: unverifiable
  // stays unattributed rather than blaming a stranger's session.
  const self = await verifiedSelfSession()
  let res: { taskId: string; queued: boolean }
  try {
    res = (await daemon.request("task.delete", {
      taskId,
      force,
      deleteBranch,
      ...(self ? { requestedByTaskId: self.taskId, requestedByTabId: self.tabId } : {}),
    })) as { taskId: string; queued: boolean }
  } catch (err) {
    throw deleteRecoveryError(err, taskId)
  }
  // The daemon's task.delete removes the worktree + index entry but never the
  // hosted session. Without this, a scripted delete
  // orphans the `kobe-<id>` session + its engine — invisible to every kobe UI
  // since the task is gone from tasks.json. Mirror the TUI's finishDeletedTaskFlow
  // and kill it here, after the delete RPC succeeds.
  await ctx.runtime.tearDownSession(taskId)
  if (!res.queued) return { ...res, status: "not_found" as const }
  // Removal runs in the background, so the default reply can only say the work
  // was scheduled. A caller that needs the OUTCOME (a cleanup script deciding
  // whether to retry, an agent tearing down its own fan-out) asks for it.
  if (!ctx.args.bool("wait")) return { ...res, status: "queued" as const }
  return { ...res, ...(await awaitDeletion(daemon, taskId)) }
}

/**
 * Poll the task index until the deletion resolves. The index IS the record —
 * `finish()` removes the row on success and stamps `deletion.phase = "error"`
 * with the git failure on it — so this reads the outcome rather than tracking
 * a second copy of it. Previously that error reached `daemon.log` and nowhere
 * else, which is how a failed removal came back looking like a successful one.
 */
async function awaitDeletion(
  daemon: DaemonRpc,
  taskId: string,
): Promise<{ status: "removed" | "failed" | "pending"; error?: string }> {
  const deadline = Date.now() + DELETE_WAIT_TIMEOUT_MS
  for (;;) {
    const { tasks } = await daemon.request<{ tasks: SerializedTask[] }>("task.list")
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return { status: "removed" }
    const deletion = task.deletion
    if (deletion?.phase === "error") {
      return { status: "failed", error: deletion.error ?? "worktree removal failed" }
    }
    // A worktree teardown is filesystem-bound and can take tens of seconds, so
    // running out of patience is not the same as failing: `pending` says the
    // deletion is still owned by the daemon and the caller should look again,
    // never that it was refused.
    if (Date.now() >= deadline) return { status: "pending" }
    await new Promise((resolve) => setTimeout(resolve, DELETE_POLL_INTERVAL_MS))
  }
}

export async function land(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const taskId = ctx.args.require("task-id")
  // `--dry-run` returns the same probe the land itself runs first, and writes
  // nothing: the destination branch, how many commits would land, whether the
  // base is dirty, and the refusal if there is one. A coordinator deciding
  // WHICH sibling to land needs this before it picks; a human needs it because
  // the destination is the base checkout's current branch, which nothing else
  // tells them until the success toast.
  if (ctx.args.bool("dry-run") === true) {
    const res = await daemon.request<{ result: unknown }>("task.landPreflight", { taskId })
    return res.result
  }
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
      // an opt-in it does not have.
      removeWorktree: ctx.args.bool("remove-worktree"),
      // Sent on EVERY land: the daemon refuses to remove the worktree the
      // caller is running from, and it can only know where that is if we tell
      // it. Removal is the default, so an agent landing its own task would
      // otherwise delete its own cwd.
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
  return new ApiError(splitDaemonCode(message)?.rest ?? message, EMPTY_BRANCH_DIRTY_WORKTREE_CODE, {
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

/**
 * Give `delete`'s dirty-worktree refusal the same executable recovery `land`
 * gets. This is the refusal an unattended cleanup loop hits most, and the
 * recovery is deliberately NOT `--force`: uncommitted files in a task
 * worktree are somebody's unlanded work, so the first move is to send the
 * worker back to commit it, exactly as EMPTY_BRANCH_DIRTY_WORKTREE does.
 * Discarding the work stays a decision a caller has to make in words.
 *
 * The generic boundary ({@link splitDaemonCode} in `toApiError`) already
 * lifts `DIRTY_WORKTREE` into `code` on its own; this adds only the two
 * self-healing fields, which need the task id the boundary does not have.
 */
function deleteRecoveryError(err: unknown, taskId: string): unknown {
  const message = errorMessage(err)
  const coded = splitDaemonCode(message)
  if (coded?.code !== DIRTY_WORKTREE_CODE) return err
  return new ApiError(coded.rest, DIRTY_WORKTREE_CODE, {
    taskId,
    hint: "the worktree still holds uncommitted or untracked files — send the worker back to commit them, or pass --force to delete the task AND discard that work",
    nextCommandArgs: [
      "api",
      "send",
      "--task-id",
      taskId,
      "--prompt",
      "your worktree has uncommitted changes and this task is being cleaned up — commit them yourself with a proper message, then report back",
    ],
  })
}

export async function adopt(ctx: VerbContext): Promise<unknown> {
  const daemon = daemonOf(ctx)
  const { args } = ctx
  const input: Record<string, string> = {
    repo: args.requireRepo("repo"),
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
