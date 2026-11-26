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
import { isWindowsMachine } from "../../machines/windows-remote.ts"
import { deriveTitleFromPrompt } from "../../orchestrator/title.ts"
import { openDirSession, startDirSession } from "./add-dir-session.ts"
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
  // `rx` is sh over ssh: refused before that machine cuts a worktree it would only take back down.
  if (isWindowsMachine(entry)) {
    throw new ApiError(
      `--workspace-on cannot reach "${alias}", a Windows machine: run the engine there with --machine ${alias} --engine-there`,
      "UNSUPPORTED",
      helpStep("add"),
    )
  }
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
    dir = await createRemoteLink({
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
    task = await openDirSession(ctx, daemon, dir, title, true)
  } catch (err) {
    removeRemoteLink(dir)
    await undo()
    throw err
  }
  const where = { machine: alias, remoteTaskId: there.taskId, remotePath: there.worktreePath, home: homeDir() }
  return startDirSession(ctx, daemon, task, dir, where)
}
