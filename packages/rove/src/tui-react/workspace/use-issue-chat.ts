/**
 * Kanban drawer → engine session. `placement` says WHERE it runs, `jump`
 * whether the user follows or stays on the board; every combination LAUNCHES
 * the engine immediately in the hosted PTY (`tui/workspace/issue-chat-spawn.ts`),
 * so a jump only attaches to an already-running session.
 *
 *   - `worktree`: create the story's task and link the issue (stamps
 *     issue.taskId, flips it `doing`, arms the daemon's done-mirror), spawn its
 *     tab-1 headlessly, persist the snapshot. Jump = enter the task.
 *   - `project`: no worktree; a session of its own in the project's checkout,
 *     the prompt riding its spawn. Jump = enter that session.
 *
 * Images need no side channel: `images[N]: /path` lines live in the issue BODY.
 */

import { userFacingErrorMessage } from "@sma1lboy/rove-core/lib/error-message.ts"
import { taskCwd } from "@sma1lboy/rove-core/orchestrator/task-tree.ts"
import {
  type IssueChatPlacement,
  issueChatTaskTitle,
  issueProjectPrompt,
} from "@sma1lboy/rove-core/state/issue-chat.ts"
import { addSavedRepo } from "@sma1lboy/rove-core/state/repos.ts"
import { setLastActiveVendor } from "@sma1lboy/rove-core/state/vendor-prefs.ts"
import type { Task, VendorId } from "@sma1lboy/rove-core/types/task.ts"
import type { Issue } from "@sma1lboy/rove-daemon/daemon/issues-store"
import { roveApiInvocation } from "../../engine/interactive-command"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import { buildIssueChatBackgroundSpawn } from "../../tui/workspace/issue-chat-spawn"
import { useT } from "../i18n"
import { setTaskTabs } from "./terminal-tabs-shared"

export interface IssueChatStart {
  readonly repoRoot: string
  /** Edited title/body already saved. */
  readonly issue: Issue
  readonly vendor: VendorId
  readonly placement: IssueChatPlacement
  readonly jump: boolean
}

export interface IssueChatOrchestrator {
  createTask(input: { repo: string; title?: string; vendor?: VendorId }): Promise<Task>
  ensureProject(repo: string): Promise<string>
  openDirectoryTask(input: { dir: string; vendor?: VendorId }): Promise<Task>
  ensureWorktree(id: string): Promise<string>
  mutateIssue(repoRoot: string, op: unknown): Promise<unknown>
}

export interface UseIssueChatResult {
  /** Kanban detail drawer's start action. Errors surface via `notifyError`. */
  readonly start: (request: IssueChatStart) => Promise<void>
}

export function useIssueChat(
  orch: IssueChatOrchestrator,
  hooks: {
    selectTask: (id: string) => void
    enterTask: (id: string) => Promise<void>
    /** Close the kanban page before landing on the session's workspace. */
    closeKanban: () => void
    notifyError: (message: string) => void
    notifyInfo: (message: string) => void
  },
): UseIssueChatResult {
  const t = useT()

  async function enter(taskId: string): Promise<void> {
    hooks.closeKanban()
    hooks.selectTask(taskId)
    await hooks.enterTask(taskId)
  }

  async function finish(request: IssueChatStart, enterTaskId: string): Promise<void> {
    if (request.jump) await enter(enterTaskId)
    else hooks.notifyInfo(t("kanban.detail.startedBackground", { title: issueChatTaskTitle(request.issue) }))
  }

  /** `project` placement: a story session of its own in the project's checkout. */
  async function startProjectTab(request: IssueChatStart, api: string): Promise<void> {
    const { repoRoot, issue, vendor } = request
    await orch.mutateIssue(repoRoot, { type: "setStatus", id: issue.id, status: "doing" }).catch((err: unknown) => {
      // Best-effort (must not strand the chat), but said: otherwise the card
      // silently stays in Backlog while its session runs.
      console.error("[rove kanban] issue setStatus failed:", err)
      hooks.notifyError(t("kanban.statusFailed", { id: String(issue.id), error: userFacingErrorMessage(err) }))
    })
    const child = await orch.openDirectoryTask({ dir: await orch.ensureProject(repoRoot), vendor })
    const spawn = buildIssueChatBackgroundSpawn({
      issue,
      taskId: child.id,
      repoRoot,
      worktreePath: taskCwd(child),
      vendor,
      api,
      kind: child.kind,
      prompt: issueProjectPrompt(issue, api),
    })
    getDefaultPtyRegistry().acquire(spawn.ptyKey, taskCwd(child), {
      command: spawn.command,
      initialInput: spawn.initialInput,
      firstMessage: spawn.firstMessage,
      engineBin: spawn.engineBin,
    })
    setTaskTabs(child.id, spawn.tabsSnapshot)
    await finish(request, child.id)
  }

  async function startWorktreeTask(request: IssueChatStart, api: string): Promise<{ task: Task }> {
    const { repoRoot, issue, vendor } = request
    setLastActiveVendor(vendor)
    addSavedRepo(repoRoot)
    const task = await orch.createTask({ repo: repoRoot, title: issueChatTaskTitle(issue), vendor })
    await orch.mutateIssue(repoRoot, { type: "link", id: issue.id, taskId: task.id }).catch((err: unknown) => {
      // Best-effort too, but said: otherwise no `linked to a session` badge
      // and no "open the linked session" in the drawer.
      console.error("[rove kanban] issue link failed:", err)
      hooks.notifyError(t("kanban.linkFailed", { id: String(issue.id), error: userFacingErrorMessage(err) }))
    })
    const worktreePath = await orch.ensureWorktree(task.id)
    const spawn = buildIssueChatBackgroundSpawn({ issue, taskId: task.id, repoRoot, worktreePath, vendor, api })
    getDefaultPtyRegistry().acquire(spawn.ptyKey, worktreePath, {
      command: spawn.command,
      initialInput: spawn.initialInput,
      firstMessage: spawn.firstMessage,
      engineBin: spawn.engineBin,
    })
    setTaskTabs(task.id, spawn.tabsSnapshot)
    return { task }
  }

  async function start(request: IssueChatStart): Promise<void> {
    try {
      const api = roveApiInvocation()
      if (request.placement === "project") {
        await startProjectTab(request, api)
        return
      }
      const { task } = await startWorktreeTask(request, api)
      await finish(request, task.id)
    } catch (err) {
      hooks.notifyError(t("tasks.toast.issueChatFailed", { error: userFacingErrorMessage(err) }))
    }
  }

  return { start }
}
