/**
 * `add --workspace-on <machine>`: the agent runs here, its files and commands live on that machine.
 * That machine cuts the worktree (`add --worktree-only` there, so it needs Rove but no engine), or with
 * `--no-worktree` holds an engineless row on the checkout itself; this one links to it
 * (`machines/remote-workspace.ts`) and starts the engine in the link directory.
 */

import { homeDir } from "@sma1lboy/rove-core/env.ts"
import { errorMessage } from "@sma1lboy/rove-core/lib/error-message.ts"
import type { MachineEntry } from "@sma1lboy/rove-core/machines/registry.ts"
import {
  createRemoteLink,
  readRemoteWorkspace,
  remotePathKey,
  remoteWorkspaceDir,
  removeRemoteLink,
} from "@sma1lboy/rove-core/machines/remote-workspace.ts"
import { machineSshArgs } from "@sma1lboy/rove-core/machines/ssh-args.ts"
import { isWindowsPath } from "@sma1lboy/rove-core/machines/windows-remote.ts"
import { deriveTitleFromPrompt } from "@sma1lboy/rove-core/orchestrator/title.ts"
import type { ApiParams, SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { remoteNotesFiles } from "../../engine/registry.ts"
import { forwardVerb, machineRequest, requireMachine } from "../../machines/forward.ts"
import { forwardedMcp } from "../../machines/remote-mcp.ts"
import { openDirSession, startDirSession } from "./add-dir-session.ts"
import { daemonOf } from "./handler-helpers.ts"
import { ApiError, type VerbContext, helpStep } from "./types.ts"

/** Flags that shape a local worktree or a round of them: none of that exists for a workspace elsewhere. */
const LOCAL_ONLY = ["count", "agents", "fork", "workspace", "isolate-in", "worktree-only", "tier"]
/** What only a new worktree takes. */
const NEW_WORKTREE_FLAGS = ["branch", "base-branch", "clone", "allow-fork"]

export async function addOnMachine(ctx: VerbContext, alias: string): Promise<unknown> {
  const { args } = ctx
  const daemon = daemonOf(ctx)
  const inPlace = args.bool("no-worktree")
  const clash = [...LOCAL_ONLY, ...(inPlace ? NEW_WORKTREE_FLAGS : [])].find((flag) => args.str(flag) !== undefined)
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
  // A checkout already linked keeps its one row there: every session on it shares the link directory.
  const linked = inPlace ? await linkedCheckout(entry, repos[0] ?? "") : undefined
  const there =
    linked ??
    (inPlace
      ? await openCheckoutThere(entry, repos[0] ?? "", title)
      : await cutWorktreeThere(entry, {
          repo: repos[0] ?? "",
          "worktree-only": true,
          ...(title ? { title } : {}),
          ...NEW_WORKTREE_FLAGS.reduce<ApiParams>((acc, flag) => Object.assign(acc, pass(flag)), {}),
        }))
  // Past this point a failure takes back down what this call made (a checkout's own files are never touched).
  const undo = async () => {
    if (!linked) await forwardVerb(entry, "delete", { "task-id": there.taskId, wait: true, force: true })
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
      mcp: forwardedMcp(alias, entry.mcp ?? []).map((f) => f.server),
    })
  } catch (err) {
    await undo()
    throw new ApiError(errorMessage(err), "MACHINE_UNREACHABLE", { machine: alias })
  }

  let task: SerializedTask
  try {
    task = await openDirSession(ctx, daemon, dir, title, true)
  } catch (err) {
    if (!linked) removeRemoteLink(dir)
    await undo()
    throw err
  }
  const where = { machine: alias, remoteTaskId: there.taskId, remotePath: there.worktreePath, home: homeDir() }
  return startDirSession(ctx, daemon, task, dir, where)
}

interface There {
  readonly taskId: string
  readonly task: SerializedTask
  readonly worktreePath: string
}

async function cutWorktreeThere(entry: MachineEntry, params: ApiParams): Promise<There> {
  const cut = await forwardVerb(entry, "add", params)
  if (!cut.ok)
    throw new ApiError(cut.error.message, cut.error.code, cut.error.data as Record<string, unknown> | undefined)
  return cut.result as There
}

/**
 * `--no-worktree`: the checkout itself, held there by an engineless `dir` row that no client lists (as a
 * `--worktree-only` one is not), so the Files pane and diff have a task there to read through.
 */
async function openCheckoutThere(entry: MachineEntry, repo: string, title: string): Promise<There> {
  if (!isWindowsPath(repo) && !repo.startsWith("/")) {
    throw new ApiError(
      `--workspace-on with --no-worktree takes the checkout's absolute path on "${entry.alias}" as --repo, not "${repo}"`,
      "BAD_FLAG",
      helpStep("add"),
    )
  }
  const { task } = await machineRequest<{ task: SerializedTask }>(entry, "task.openDir", {
    dir: repo,
    ...(title ? { title } : {}),
  })
  await machineRequest(entry, "task.worktreeOnly", { taskId: task.id, on: true })
  const repoId = task.repoId ?? (await repoIdThere(entry, repo))
  return { taskId: task.id, task: { ...task, ...(repoId ? { repoId } : {}) }, worktreePath: task.worktreePath || repo }
}

/** The row there behind an existing link to this checkout, while that machine still has it. */
async function linkedCheckout(entry: MachineEntry, repo: string): Promise<There | undefined> {
  const ws = readRemoteWorkspace(remoteWorkspaceDir(entry.alias, repo, repo))
  if (!ws || ws.machine !== entry.alias || remotePathKey(ws.path) !== remotePathKey(repo)) return undefined
  const got = await forwardVerb(entry, "get-task", { "task-id": ws.taskId })
  if (!got.ok) {
    if (got.error.code === "TASK_NOT_FOUND") return undefined
    throw new ApiError(got.error.message, got.error.code, got.error.data as Record<string, unknown> | undefined)
  }
  const { task } = got.result as { task: SerializedTask }
  return { taskId: ws.taskId, task: { ...task, ...(ws.repoId ? { repoId: ws.repoId } : {}) }, worktreePath: ws.path }
}

/** The checkout's repo id as that machine's `repo-list` names it: a daemon there may hold a stale "none". */
async function repoIdThere(entry: MachineEntry, path: string): Promise<string | undefined> {
  const listed = await forwardVerb(entry, "repo-list", {})
  if (!listed.ok) return undefined
  const repos = (listed.result as { repos?: { id: string; checkouts: string[] }[] }).repos ?? []
  return repos.find((r) => r.checkouts.some((c) => remotePathKey(c) === remotePathKey(path)))?.id
}
