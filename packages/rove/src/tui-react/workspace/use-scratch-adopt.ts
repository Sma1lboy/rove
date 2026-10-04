/**
 * Scratch-task adoption loop over the pure `decideScratchAdopt`. Each tick, per
 * scratch task with an attached live shell: where has it settled (live cwd →
 * repo main root), and is a coding harness confirmed running (live-engine
 * walk, same bar as tab identity)? Both true →
 *
 *   - `fold`: the cwd belongs to an existing task; the shell (session and all)
 *     becomes that task's new tab (`foldScratchShell`) and the scratch row is
 *     deleted, so no duplicate row for a listed directory.
 *   - `adopt`: no owner; the row migrates into that repo's project group
 *     (`orch.adoptScratchRepo`).
 *
 * Deliberately quiet: no dialog, no focus steal. Adopt keeps the task id so
 * selection follows; fold drops it, so `onFold` re-points selection ONLY if
 * the scratch row was selected. An UNFAMILIAR repo gets a non-modal "save as
 * project" hint, never a gate on the move.
 *
 * Only this TUI's attached PTYs are consulted; unattached scratch tasks wait.
 * Cost: one lsof per scratch task per tick, and scratch tasks are rare.
 */

import { useEffect } from "react"
import type { RemoteOrchestrator } from "../../client/remote-orchestrator"
import { processCwd } from "../../engine/process-cwd"
import { canonPath } from "../../orchestrator/core-helpers"
import { getSavedRepos, isGitRepo, resolveMainRepoRoot } from "../../state/repos"
import { t } from "../../tui/i18n"
import { repoBasename } from "../../tui/panes/sidebar/groups"
import { getDefaultPtyRegistry } from "../../tui/panes/terminal/registry"
import { getDefaultLiveEngines } from "../../tui/workspace/live-engine"
import { type ScratchOwnerTask, decideScratchAdopt } from "../../tui/workspace/scratch-adopt"
import { tabPtyKey } from "../../tui/workspace/terminal-tabs-core"
import type { Task } from "../../types/task"
import { useLatest } from "../lib/use-latest"
import { foldScratchShell } from "./scratch-fold"
import type { TabsSnapshotKv } from "./terminal-tabs-persist"

/** Same human timescale as the live-engine probe. */
const POLL_MS = 5_000

/** Tasks whose directory can already own a scratch shell's cwd. */
export function scratchOwnerTasks(tasks: readonly Task[]): ScratchOwnerTask[] {
  return tasks
    .filter((task) => !task.deletion && task.scratch !== true && task.worktreePath !== "")
    .map((task) => ({ id: task.id, kind: task.kind ?? "task", dir: canonPath(task.worktreePath) }))
}

export function useScratchAdopt(deps: {
  readonly tasks: readonly Task[]
  readonly orchestrator: RemoteOrchestrator
  readonly kv: TabsSnapshotKv
  /** Non-modal hint channel (the unfamiliar-repo nudge). */
  readonly notifyInfo: (message: string) => void
  /** Delete the emptied scratch row; follow selection if it pointed there. */
  readonly onFold: (scratchTaskId: string, targetTaskId: string, tabId: string) => Promise<void>
  readonly enabled?: boolean
}): void {
  const { tasks, orchestrator, kv, notifyInfo } = deps
  // Rebuilt every render (closes over selection); as a dep it would restart the poll.
  const onFoldRef = useLatest(deps.onFold)
  const enabled = deps.enabled ?? true
  const scratchIds = tasks
    .filter((t) => t.kind === "dir" && t.scratch === true)
    .map((t) => t.id)
    .join(",")

  useEffect(() => {
    if (!enabled || scratchIds === "") return
    let cancelled = false
    /** One adopt per task per mount; a slow RPC must not double-fire. */
    const inFlight = new Set<string>()

    const tick = async (): Promise<void> => {
      const scratch = tasks.filter((t) => t.kind === "dir" && t.scratch === true)
      if (scratch.length === 0) return
      const known = new Set<string>([...getSavedRepos(), ...tasks.map((t) => t.repo)])
      const owners = scratchOwnerTasks(tasks)
      const registry = getDefaultPtyRegistry()
      const liveEngines = getDefaultLiveEngines()
      for (const task of scratch) {
        if (inFlight.has(task.id)) continue
        // The scratch shell is tab-1 by construction (initialShellTabs).
        const key = tabPtyKey(task.id, "tab-1")
        const pid = registry.get(key)?.shellPid ?? null
        if (pid === null || pid === undefined) continue
        // Confidence gate: harness confirmed live under this shell.
        if (!liveEngines.get(key)) continue
        const rawCwd = await processCwd(pid)
        if (cancelled || !rawCwd) continue
        const cwd = canonPath(rawCwd)
        // resolveMainRepoRoot falls back to the input for non-repos, so
        // isGitRepo is the actual repo-semantics gate.
        const repoRoot = canonPath(resolveMainRepoRoot(cwd))
        const decision = decideScratchAdopt({
          cwd,
          repoRoot: isGitRepo(repoRoot) ? repoRoot : null,
          harnessLive: true,
          knownRepos: known,
          ownerTasks: owners,
        })
        if (cancelled || decision.kind === "stay") continue
        inFlight.add(task.id)
        try {
          if (decision.kind === "fold") {
            const folded = await foldScratchShell({ kv }, task.id, decision.taskId)
            // Null = nothing moved (old host / sessions gone): retry next tick
            // rather than mint a duplicate row.
            if (!folded) throw new Error("fold did not move any session")
            await onFoldRef.current(task.id, decision.taskId, folded.activeTabId)
            continue
          }
          await orchestrator.adoptScratchRepo(task.id, decision.repo)
          if (!decision.known) {
            // ponytail: non-modal hint instead of a save dialog; the move
            // must not gate on an answer.
            notifyInfo(t("tasks.toast.scratchAdopted", { repo: repoBasename(decision.repo) }))
          }
        } catch {
          inFlight.delete(task.id) // retry next tick
        }
      }
    }

    void tick()
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // scratchIds is the reactive key — tasks identity churns every snapshot.
  }, [enabled, scratchIds, orchestrator, kv, notifyInfo, tasks])
}
