/**
 * `spawnChildTask`: a new conversation as a child of an existing task, either
 * in the parent's own directory (a shared child) or in a fresh worktree cut
 * from the parent's current branch tip. Takes its collaborators, not the
 * Orchestrator.
 */

import { isAbsolute, relative, resolve, sep } from "node:path"
import type { SpawnChildInput, TaskDispatcher } from "@sma1lboy/rove-daemon/daemon/contracts"
import { taskCwd } from "@sma1lboy/rove-daemon/task-tree"
import { isGitRepo, isRemoteRepoKey, resolveMainRepoRoot } from "../state/repos.ts"
import type { Task, TaskId } from "../types/task.ts"
import { toTaskId } from "../types/task.ts"
import { canonPath } from "./core-helpers.ts"
import type { CreateTaskInput } from "./create-task-input.ts"
import {
  NotAGitRepoError,
  NotALinkedRepoError,
  RemoteParentUnsupportedError,
  TaskDeletingError,
  TaskNotFoundError,
} from "./errors.ts"
import type { TaskIndexStore } from "./index/store.ts"
import { type LinkedRepo, scanLinkedRepos } from "./linked-repos.ts"
import { PLACEHOLDER_TASK_TITLE, sanitizeTaskTitle } from "./title.ts"
import { git } from "./worktree/git.ts"
import type { GitWorktreeManager } from "./worktree/manager.ts"

export type { SpawnChildInput }

export interface SpawnChildResult {
  readonly task: Task
  readonly parentDirty: boolean
  readonly sharedLinks: string[]
}

export interface SpawnChildDeps {
  readonly store: TaskIndexStore
  readonly worktrees: Pick<GitWorktreeManager, "dirtyPaths">
  readonly createTask: (input: CreateTaskInput) => Promise<Task>
  /** Materialises a managed task's worktree (a sharer resolves to its owner's). */
  readonly ensureWorktree: (id: TaskId) => Promise<string>
}

export async function spawnChildTaskRow(deps: SpawnChildDeps, input: SpawnChildInput): Promise<SpawnChildResult> {
  const found = deps.store.get(input.parentTaskId)
  if (!found) throw new TaskNotFoundError(input.parentTaskId)
  if (found.deletion) throw new TaskDeletingError(String(found.id))
  if (isRemoteRepoKey(found.repo)) throw new RemoteParentUnsupportedError(String(found.id))
  if (input.isolateIn && !input.worktree) throw new Error("INVALID_SPAWN: isolateIn needs a worktree child")

  // A lazy managed parent has no directory until first entered.
  const workspace = found.kind === "task" ? await deps.ensureWorktree(found.id) : found.worktreePath
  const parent = deps.store.get(found.id) ?? found
  const cwd = taskCwd({ worktreePath: workspace, cwdSubpath: parent.cwdSubpath })
  const links = scanLinkedRepos(cwd)

  // A child with neither engine field set runs what its parent runs.
  const inherit = !input.vendor && !input.command
  const common = {
    title: sanitizeTaskTitle(input.title ?? PLACEHOLDER_TASK_TITLE) || PLACEHOLDER_TASK_TITLE,
    vendor: input.vendor ?? parent.vendor,
    command: input.command ?? (inherit ? parent.command : undefined),
    dispatcher: input.dispatcher as TaskDispatcher | undefined,
  }

  if (!input.worktree) {
    const owner = toTaskId(parent.sharesWorkspaceOf ?? parent.id)
    const task = await deps.store.create({
      repo: parent.repo,
      branch: parent.kind === "task" ? parent.branch : "",
      worktreePath: workspace,
      status: "backlog",
      kind: parent.kind === "task" ? "task" : "dir",
      title: common.title,
      vendor: common.vendor,
      ...(common.command?.trim() ? { command: common.command.trim() } : {}),
      ...(common.dispatcher ? { dispatcher: common.dispatcher } : {}),
      ...(parent.kind === "task" && parent.baseRef ? { baseRef: parent.baseRef } : {}),
      ...(parent.cwdSubpath ? { cwdSubpath: parent.cwdSubpath } : {}),
      ...(input.prompt ? { prompt: input.prompt } : {}),
      parentTaskId: parent.id,
      sharesWorkspaceOf: owner,
    })
    return { task, parentDirty: await isDirty(deps, cwd), sharedLinks: links.map((l) => l.name) }
  }

  const source = input.isolateIn ? requireLink(links, input.isolateIn, cwd) : undefined
  const sourceDir = source?.path ?? cwd
  if (!source && !isGitRepo(sourceDir)) throw new NotAGitRepoError(sourceDir)

  const top = source ? sourceDir : gitOut(sourceDir, ["rev-parse", "--show-toplevel"])
  const sub = relative(canonPath(top), canonPath(sourceDir))
  const cwdSubpath = sub && !sub.split(sep).includes("..") && !isAbsolute(sub) ? sub : undefined
  const baseRef = input.baseRef?.trim() || gitOut(sourceDir, ["rev-parse", "HEAD"])
  // Keep a managed parent's own repo key; a dir or linked repo resolves to its primary checkout.
  const repo = source || parent.kind === "dir" ? resolveMainRepoRoot(sourceDir) : parent.repo
  const parentDirty = await isDirty(deps, sourceDir)

  const child = await deps.createTask({
    repo,
    title: common.title,
    baseRef,
    vendor: common.vendor,
    command: common.command,
    dispatcher: common.dispatcher,
    parentTaskId: parent.id,
    cwdSubpath,
    projectIntent: "derived",
  })
  // Eager, so a refused checkout surfaces here and never leaves a pathless child.
  try {
    await deps.ensureWorktree(child.id)
  } catch (err) {
    await deps.store.remove(child.id)
    throw err
  }
  if (input.prompt) await deps.store.update(child.id, { prompt: input.prompt })
  const task = deps.store.get(child.id) ?? child
  return { task, parentDirty, sharedLinks: source ? [] : links.map((l) => l.name) }
}

/** `--isolate-in` names a top-level link: by name, or by a path that resolves to one directly under `cwd`. */
function requireLink(links: readonly LinkedRepo[], isolateIn: string, cwd: string): LinkedRepo {
  const name = isAbsolute(isolateIn) || isolateIn.includes("/") ? relative(cwd, resolve(cwd, isolateIn)) : isolateIn
  const link = links.find((l) => l.name === name)
  if (!link)
    throw new NotALinkedRepoError(
      isolateIn,
      links.map((l) => l.name),
    )
  return link
}

function gitOut(cwd: string, args: readonly string[]): string {
  return git(args, { cwd, readOnly: true }).stdout.trim()
}

/** Unreadable status reads as clean: the flag is advisory, never a reason to refuse a spawn. */
async function isDirty(deps: SpawnChildDeps, dir: string): Promise<boolean> {
  try {
    return (await deps.worktrees.dirtyPaths(dir)).length > 0
  } catch {
    return false
  }
}
