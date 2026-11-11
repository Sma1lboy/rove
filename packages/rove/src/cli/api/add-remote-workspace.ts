/**
 * `add --workspace-on <machine>`: the agent runs here, its files and commands live on that machine.
 * That machine cuts the worktree (`add --worktree-only` there, so it needs Rove but no engine); this one
 * links to it (`machines/remote-workspace.ts`) and starts the engine in the link directory.
 */

import type { ApiParams, SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { remoteNotesFiles } from "../../engine/registry.ts"
import { homeDir } from "../../env.ts"
import { errorMessage } from "../../lib/error-message.ts"
import { forwardVerb, requireMachine } from "../../machines/forward.ts"
import { createRemoteLink, removeRemoteLink } from "../../machines/remote-workspace.ts"
import { machineSshArgs } from "../../machines/ssh-args.ts"
import { deriveTitleFromPrompt } from "../../orchestrator/title.ts"
import type { VendorId } from "../../types/vendor.ts"
import { applyPostCreateFlags, deliverArmed, persistPrompt } from "./add-delivery.ts"
import { effortFor, engineChoice, launchedEngine, modelFor } from "./add-engine-fields.ts"
import { withPeerProvenance } from "./dispatcher.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, helpStep } from "./types.ts"

/** Flags that shape a local worktree or a round of them: none of that exists for a workspace elsewhere. */
const LOCAL_ONLY = ["count", "agents", "fork", "workspace", "no-worktree", "isolate-in", "worktree-only", "tier"]

export async function addOnMachine(ctx: VerbContext, alias: string): Promise<unknown> {
  const { args } = ctx
  const daemon = daemonOf(ctx)
  const clash = LOCAL_ONLY.find((flag) => args.str(flag) !== undefined)
  const repos = args.list("repo")
  if (clash || repos.length > 1) {
    throw new ApiError(
      `--workspace-on takes one task in one repo on that machine: it conflicts with ${clash ? `--${clash}` : "a second --repo"}`,
      "CONFLICTING_FLAGS",
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
  const entry = requireMachine(alias)
  const title = args.str("title") || (prompt ? deriveTitleFromPrompt(prompt) : "")
  const pass = (flag: string): ApiParams => {
    const value = args.str(flag)
    return value === undefined ? {} : { [flag]: value }
  }
  const cut = await forwardVerb(entry, "add", {
    repo: repos[0] ?? "",
    "worktree-only": true,
    ...(title ? { title } : {}),
    ...pass("branch"),
    ...pass("base-branch"),
    ...pass("clone"),
    ...pass("allow-fork"),
  })
  if (!cut.ok)
    throw new ApiError(cut.error.message, cut.error.code, cut.error.data as Record<string, unknown> | undefined)
  const there = cut.result as { taskId: string; task: SerializedTask; worktreePath: string }
  // Past this point a failure takes the worktree it just cut back down.
  const undo = async () => {
    await forwardVerb(entry, "delete", { "task-id": there.taskId, wait: true, force: true })
  }

  let dir: string
  try {
    dir = createRemoteLink({
      ws: {
        machine: alias,
        taskId: there.taskId,
        path: there.worktreePath,
        branch: there.task.branch,
        ...(there.task.repoId ? { repoId: there.task.repoId } : {}),
      },
      repo: there.task.repo,
      sshArgv: machineSshArgs(alias, entry),
      engineNotes: remoteNotesFiles(),
    })
  } catch (err) {
    await undo()
    throw new ApiError(errorMessage(err), "MACHINE_UNREACHABLE", { machine: alias })
  }

  let task: SerializedTask
  try {
    const choice = await engineChoice(ctx, dir)
    const engines = choice.vendor ? [choice.vendor] : []
    const effort = effortFor(ctx, engines)
    const model = modelFor(ctx, engines)
    const opened = await daemon.request<{ task: SerializedTask }>("task.openDir", {
      dir,
      remote: true,
      ...(choice.vendor ? { vendor: choice.vendor } : {}),
      ...(title ? { title } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
    })
    task = opened.task
    if (choice.command) await daemon.request("task.setCommand", { taskId: task.id, command: choice.command })
  } catch (err) {
    removeRemoteLink(dir)
    await undo()
    throw err
  }
  const taskId = task.id
  if (args.bool("activate")) await daemon.request("task.setActive", { taskId })
  await applyPostCreateFlags(daemon, taskId, args)
  const target = {
    id: taskId,
    worktreePath: dir,
    kind: task.kind,
    vendor: task.vendor as VendorId | undefined,
    command: task.command,
    modelEffort: task.modelEffort,
    model: task.model,
    repo: task.repo,
  }
  const where = { machine: alias, remoteTaskId: there.taskId, remotePath: there.worktreePath, home: homeDir() }
  if (!prompt) {
    const opened = await ctx.runtime.openTab(daemon, target, "engine")
    return { taskId, task, engine: launchedEngine(task), ...where, started: true, tabId: opened.tab.id }
  }
  const brief = await withPeerProvenance(daemon, taskId, prompt)
  const delivered = await deliverArmed(ctx, daemon, taskId, { ...target, newTask: true }, brief)
  if (!delivered.delivered) {
    throw new ApiError(`task ${taskId} created but the prompt was not delivered`, "NOT_DELIVERED", { taskId, ...where })
  }
  await persistPrompt(daemon, taskId, prompt)
  task = (await daemon.request<{ task: SerializedTask }>("task.get", { taskId })).task
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
