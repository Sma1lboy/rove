/** Bootstrap for the kobe core: orchestrator + worktree manager + task index. */

import { homedir } from "node:os"
import { readRoveHomeDirEnv } from "@sma1lboy/kobe-daemon/compat-env"
import {
  auditDeletionBranchKept,
  auditDeletionResidue,
  auditDeletionSalvaged,
} from "@sma1lboy/kobe-daemon/daemon/task-deletion-audit"
import { Orchestrator } from "../orchestrator/core.ts"
import { TaskIndexStore } from "../orchestrator/index/store.ts"
import { GitWorktreeManager } from "../orchestrator/worktree/manager.ts"
import { backfillSavedReposFromProjects } from "../state/repos.ts"
import { tearDownTaskSessionAdapter } from "./daemon-session-adapter.ts"

export interface KobeCoreOptions {
  readonly homeDir?: string
}

export interface KobeCore {
  readonly homeDir: string
  readonly orchestrator: Orchestrator
  readonly store: TaskIndexStore
  readonly worktrees: GitWorktreeManager
  close(): Promise<void>
}

export async function createKobeCore(options: KobeCoreOptions = {}): Promise<KobeCore> {
  const homeDir = options.homeDir ?? readRoveHomeDirEnv() ?? homedir()
  const store = new TaskIndexStore({ homeDir })
  await store.load()
  const worktrees = new GitWorktreeManager()
  const orchestrator = new Orchestrator({
    store,
    worktrees,
    // These three go to daemon.log's deletion audit trail, where TROUBLESHOOTING
    // sends users; the task row is gone by then, so it's the only record.
    onSalvage: (taskId, salvage) =>
      auditDeletionSalvaged(String(taskId), salvage.ref, salvage.commit, store.get(taskId)?.repo, salvage.uncaptured),
    onWorktreeResidue: (taskId, residue) => auditDeletionResidue(String(taskId), residue.path, residue.reason),
    onBranchKept: (taskId, kept) => auditDeletionBranchKept(String(taskId), kept.branch, kept.reason),
    // Tear down before a landed worktree is unlinked, as task deletion does.
    tearDownSession: (taskId) => tearDownTaskSessionAdapter(String(taskId)),
  })

  // Older kobe rows are in the sidebar but not the picker. Idempotent, once per boot.
  const backfilled = backfillSavedReposFromProjects(
    store
      .list()
      .filter((task) => task.kind === "main")
      .map((task) => task.repo),
  )
  if (backfilled.length > 0) {
    console.error(`[rove] added ${backfilled.length} existing project(s) to the new-task picker`)
  }

  return {
    homeDir,
    orchestrator,
    store,
    worktrees,
    async close() {
      orchestrator.dispose()
    },
  }
}
