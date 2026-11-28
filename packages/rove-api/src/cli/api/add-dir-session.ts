/**
 * `add` into a directory session: one conversation in a directory as it is, with no worktree or branch.
 * Shared by a workspace on another machine (`add --workspace-on`, the link directory) and a plain folder
 * git knows nothing about (`add --repo <folder>`).
 */

import { statSync } from "node:fs"
import type { DaemonRpc } from "@sma1lboy/rove-core/client/daemon-session.ts"
import { homeDir } from "@sma1lboy/rove-core/env.ts"
import { deriveTitleFromPrompt } from "@sma1lboy/rove-core/orchestrator/title.ts"
import type { VendorId } from "@sma1lboy/rove-core/types/vendor.ts"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { applyPostCreateFlags, deliverArmed, persistPrompt } from "./add-delivery.ts"
import { effortFor, engineChoice, launchedEngine, modelFor } from "./add-engine-fields.ts"
import { withPeerProvenance } from "./dispatcher.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, helpStep } from "./types.ts"

/** Flags that need a repo: a branch, a worktree, a round of them, or a parent task's checkout. */
const NEEDS_GIT = [
  "branch",
  "base-branch",
  "base-for",
  "worktree-name",
  "worktree-only",
  "workspace",
  "clone",
  "fork",
  "count",
  "agents",
  "tier",
  "parent",
  "no-worktree",
  "isolate-in",
  "handoff-from",
]

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** The `dir` row with the engine the flags name. `remote` marks the link directory of a workspace elsewhere. */
export async function openDirSession(
  ctx: VerbContext,
  daemon: DaemonRpc,
  dir: string,
  title: string,
  remote = false,
): Promise<SerializedTask> {
  const choice = await engineChoice(ctx)
  const engines = choice.vendor ? [choice.vendor] : []
  const effort = effortFor(ctx, engines)
  const model = modelFor(ctx, engines)
  const opened = await daemon.request<{ task: SerializedTask }>("task.openDir", {
    dir,
    ...(remote ? { remote: true } : {}),
    ...(choice.vendor ? { vendor: choice.vendor } : {}),
    ...(title ? { title } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
  })
  if (choice.command) await daemon.request("task.setCommand", { taskId: opened.task.id, command: choice.command })
  return opened.task
}

/** Start the engine in `dir` for a row {@link openDirSession} made: the first prompt, or idle with `--start`. */
export async function startDirSession(
  ctx: VerbContext,
  daemon: DaemonRpc,
  opened: SerializedTask,
  dir: string,
  where: Record<string, unknown>,
): Promise<unknown> {
  const { args } = ctx
  const prompt = args.promptText()
  const taskId = opened.id
  if (args.bool("activate")) await daemon.request("task.setActive", { taskId })
  await applyPostCreateFlags(daemon, taskId, args)
  const target = {
    id: taskId,
    worktreePath: dir,
    kind: opened.kind,
    vendor: opened.vendor as VendorId | undefined,
    command: opened.command,
    modelEffort: opened.modelEffort,
    model: opened.model,
    repo: opened.repo,
  }
  if (!prompt) {
    const tab = await ctx.runtime.openTab(daemon, target, "engine")
    return { taskId, task: opened, engine: launchedEngine(opened), ...where, started: true, tabId: tab.tab.id }
  }
  const brief = args.bool("no-dispatcher") === true ? prompt : await withPeerProvenance(daemon, taskId, prompt)
  const delivered = await deliverArmed(ctx, daemon, taskId, { ...target, newTask: true }, brief)
  if (!delivered.delivered) {
    throw new ApiError(`task ${taskId} created but the prompt was not delivered`, "NOT_DELIVERED", { taskId, ...where })
  }
  await persistPrompt(daemon, taskId, prompt)
  const task = (await daemon.request<{ task: SerializedTask }>("task.get", { taskId })).task
  return {
    taskId,
    task,
    engine: launchedEngine(task),
    ...where,
    started: delivered.started,
    engineReady: delivered.engineReady,
    session: delivered.session,
    delivered: delivered.delivered,
  }
}

/**
 * `add --repo <folder>` where the folder is not a git repository: the session runs in the folder itself.
 * Read at each `add`, so the same folder gets worktree tasks once it is a repository.
 */
export async function addInPlainFolder(ctx: VerbContext, dir: string): Promise<unknown> {
  const { args } = ctx
  const clash = NEEDS_GIT.find((flag) => args.str(flag) !== undefined)
  if (clash || args.list("repo").length > 1) {
    throw new ApiError(
      `--repo ${dir} is not a git repository, so a session there runs in the folder itself: ${clash ? `--${clash}` : "a second --repo"} needs a repository (run \`git init\` there, or point --repo at a checkout)`,
      "NOT_A_REPO",
      helpStep("add"),
    )
  }
  const prompt = args.promptText()
  if (!prompt && !args.bool("start")) {
    throw new ApiError(
      "add would create a task with no agent: pass --prompt/--prompt-file for work, or --start for an idle engine",
      "EMPTY_SESSION",
      helpStep("add"),
    )
  }
  const daemon = daemonOf(ctx)
  const title = args.str("title") || (prompt ? deriveTitleFromPrompt(prompt) : "")
  const task = await openDirSession(ctx, daemon, dir, title)
  return startDirSession(ctx, daemon, task, dir, { home: homeDir(), worktree: false })
}
