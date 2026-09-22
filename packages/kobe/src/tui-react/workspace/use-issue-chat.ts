/**
 * Kanban drawer → engine session. `placement` says WHERE it runs, `jump`
 * whether the user follows or stays on the board; every combination LAUNCHES
 * the engine immediately in the hosted PTY (`tui/workspace/issue-chat-spawn.ts`),
 * so a jump only attaches to an already-running session.
 *
 *   - `worktree`: create the story's task and link the issue (stamps
 *     issue.taskId, flips it `doing`, arms the daemon's done-mirror), spawn its
 *     tab-1 headlessly, persist the snapshot. Jump = enter the task.
 *   - `projectWorktree`: the same, PLUS a viewport tab (`EngineTab.ptyTask`)
 *     in the repo's MAIN workspace. Jump = enter the project (viewport active).
 *   - `project`: no worktree; a NEW chattab in the main workspace with the
 *     prompt riding its spawn, so a busy tab-1 can't swallow it. Jump = enter
 *     the project.
 *
 * Images need no side channel: `images[N]: /path` lines live in the issue BODY.
 */

import { userFacingErrorMessage } from "@/lib/error-message"
import type { Issue } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import { kobeApiInvocation } from "../../engine/interactive-command"
import { type IssueChatPlacement, issueChatTaskTitle, issueProjectPrompt } from "../../state/issue-chat"
import { addSavedRepo } from "../../state/repos"
import { setRepoLastActiveVendor } from "../../state/vendor-prefs"
import { defaultShell } from "../../tui/panes/terminal/pty-types"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import { buildIssueChatBackgroundSpawn, buildIssueTabSpawn } from "../../tui/workspace/issue-chat-spawn"
import type { EngineTab } from "../../tui/workspace/terminal-tabs-core"
import type { Task, VendorId } from "../../types/task"
import { useKV } from "../context/kv"
import { useT } from "../i18n"
import { terminalTabsKey } from "./terminal-tabs-persist"
import { appendBackgroundEngineTab } from "./terminal-tabs-shared"

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
  ensureMainTask(repo: string): Promise<Task>
  ensureWorktree(id: string): Promise<string>
  setVendor(id: string, vendor: VendorId, effort?: string): Promise<void>
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
  const kv = useKV()

  async function enter(taskId: string): Promise<void> {
    hooks.closeKanban()
    hooks.selectTask(taskId)
    await hooks.enterTask(taskId)
  }

  async function finish(request: IssueChatStart, enterTaskId: string): Promise<void> {
    if (request.jump) await enter(enterTaskId)
    else hooks.notifyInfo(t("kanban.detail.startedBackground", { title: issueChatTaskTitle(request.issue) }))
  }

  /** `project` placement: a story chattab on the MAIN workspace's checkout. */
  async function startProjectTab(request: IssueChatStart, api: string): Promise<void> {
    const { repoRoot, issue, vendor } = request
    const main = await orch.ensureMainTask(repoRoot)
    await orch.setVendor(main.id, vendor)
    await orch.mutateIssue(repoRoot, { type: "setStatus", id: issue.id, status: "doing" }).catch((err: unknown) => {
      // Best-effort (must not strand the chat), but said: otherwise the card
      // silently stays in Backlog while its session runs.
      console.error("[rove kanban] issue setStatus failed:", err)
      hooks.notifyError(t("kanban.statusFailed", { id: String(issue.id), error: userFacingErrorMessage(err) }))
    })
    const { tab } = appendBackgroundEngineTab(kv, main.id, defaultShell(), { vendor })
    const spawn = buildIssueTabSpawn({
      taskId: main.id,
      repoRoot,
      worktreePath: main.worktreePath,
      tab,
      vendor,
      prompt: issueProjectPrompt(issue, api),
    })
    getDefaultPtyRegistry().acquire(spawn.ptyKey, main.worktreePath, {
      command: spawn.command,
      firstMessage: spawn.firstMessage,
      engineBin: spawn.engineBin,
    })
    await finish(request, main.id)
  }

  /** Shared by both worktree placements. */
  async function startWorktreeTask(
    request: IssueChatStart,
    api: string,
  ): Promise<{ task: Task; worktreePath: string; tab: EngineTab }> {
    const { repoRoot, issue, vendor } = request
    setRepoLastActiveVendor(repoRoot, vendor)
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
    kv.set(terminalTabsKey(task.id), spawn.tabsSnapshot)
    return { task, worktreePath, tab: spawn.tabsSnapshot.tabs[0] as EngineTab }
  }

  async function start(request: IssueChatStart): Promise<void> {
    try {
      const api = kobeApiInvocation()
      if (request.placement === "project") {
        await startProjectTab(request, api)
        return
      }
      const { task, worktreePath, tab } = await startWorktreeTask(request, api)
      if (request.placement === "projectWorktree") {
        // Same PTY key, worktree as cwd. Workspaces render one at a time, so
        // the two views attach sequentially.
        const main = await orch.ensureMainTask(request.repoRoot)
        appendBackgroundEngineTab(kv, main.id, defaultShell(), {
          vendor: request.vendor,
          sessionId: tab.sessionId ?? null,
          ptyTask: { id: task.id, worktree: worktreePath },
        })
        await finish(request, main.id)
        return
      }
      await finish(request, task.id)
    } catch (err) {
      hooks.notifyError(t("tasks.toast.issueChatFailed", { error: userFacingErrorMessage(err) }))
    }
  }

  return { start }
}
