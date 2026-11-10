/** A task as it travels on the wire: the daemon's `DaemonTask` flattened into `SerializedTask`. */

import { repoIdOf } from "../repo-id.ts"
import type { DaemonTask } from "./contracts.ts"
import type { SerializedTask } from "./protocol.ts"

/**
 * Empty-title fallback (scratch tasks mint no auto-name), filled on the wire
 * upstream of every consumer so none renders a blank row. The STORED title
 * stays empty. No truncation: consumers clip, agents want the full path.
 */
export function displayTaskTitle(task: Pick<DaemonTask, "title" | "branch" | "worktreePath" | "repo">): string {
  return task.title || task.branch || task.worktreePath || task.repo || "scratch"
}

export function serializeTask(task: DaemonTask): SerializedTask {
  const repoId = repoIdOf(task.repo)
  return {
    id: task.id,
    title: displayTaskTitle(task),
    repo: task.repo,
    branch: task.branch,
    worktreePath: task.worktreePath,
    kind: task.kind ?? "task",
    ...(task.scratch ? { scratch: true } : {}),
    ...(task.noProject ? { noProject: true } : {}),
    ...(task.routine ? { routine: task.routine } : {}),
    status: task.status,
    pinned: task.pinned ?? false,
    ...(task.kept ? { kept: true } : {}),
    ...(task.notes ? { notes: task.notes } : {}),
    ...(task.todos ? { todos: task.todos } : {}),
    ...(task.archived ? { archived: true } : {}),
    vendor: task.vendor,
    command: task.command,
    prStatus: task.prStatus,
    modelEffort: task.modelEffort,
    model: task.model,
    tier: task.tier,
    groupId: task.groupId,
    observedLanguage: task.observedLanguage,
    deletion: task.deletion,
    quotaResume: task.quotaResume,
    scheduledStart: task.scheduledStart,
    ...(task.autoFixCi ? { autoFixCi: task.autoFixCi } : {}),
    linkedWorkItem: task.linkedWorkItem,
    dispatcher: task.dispatcher,
    ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
    ...(task.sharesWorkspaceOf ? { sharesWorkspaceOf: task.sharesWorkspaceOf } : {}),
    ...(task.cwdSubpath ? { cwdSubpath: task.cwdSubpath } : {}),
    ...(task.ptyAlias ? { ptyAlias: task.ptyAlias } : {}),
    ...(task.extraRepos?.length ? { extraRepos: task.extraRepos } : {}),
    ...(task.workspace ? { workspace: task.workspace } : {}),
    ...(task.sessionPrs?.length ? { sessionPrs: task.sessionPrs } : {}),
    requireReport: task.requireReport,
    ...(task.worktreeOnly ? { worktreeOnly: true } : {}),
    prompt: task.prompt,
    baseRef: task.baseRef,
    worktreeName: task.worktreeName,
    ...(task.gitRepo ? { gitRepo: task.gitRepo } : {}),
    report: task.report,
    ...(repoId ? { repoId } : {}),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}
