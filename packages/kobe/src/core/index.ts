/**
 * Public bootstrap for the kobe "core" — the orchestrator + worktree
 * manager + task index, wired together with sensible defaults. v0.5
 * had an engine port (and an MCP bridge that exposed it to spawned
 * claude); both are gone in v0.6.
 */

import { homedir } from "node:os"
import { readRoveEnv } from "@sma1lboy/kobe-daemon/compat-env"
import { auditDeletionResidue, auditDeletionSalvaged } from "@sma1lboy/kobe-daemon/daemon/task-deletion-audit"
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
  const homeDir = options.homeDir ?? readRoveEnv("HOME_DIR") ?? homedir()
  const store = new TaskIndexStore({ homeDir })
  await store.load()
  const worktrees = new GitWorktreeManager()
  const orchestrator = new Orchestrator({
    store,
    worktrees,
    // A forced delete's salvage ref goes to daemon.log beside the rest of the
    // deletion audit trail, which is where TROUBLESHOOTING already sends a
    // user asking "what happened to my task".
    onSalvage: (taskId, salvage) =>
      auditDeletionSalvaged(String(taskId), salvage.ref, salvage.commit, store.get(taskId)?.repo),
    // The task IS deleted in this case, so nothing else will ever mention the
    // directory git could not unlink. Same log, same reason as the salvage
    // line: it is where a user is already told to look.
    onWorktreeResidue: (taskId, residue) => auditDeletionResidue(String(taskId), residue.path, residue.reason),
    // A landed worktree is about to be unlinked; anything the engine writes
    // into it after that is written to nothing. Same ordering the task-
    // deletion runner already uses.
    tearDownSession: (taskId) => tearDownTaskSessionAdapter(String(taskId)),
  })

  // Heal the projects/savedRepos split (see backfillSavedReposFromProjects):
  // rows minted before 2026-08-31 are in the sidebar but not the picker. Runs
  // once per daemon boot and is idempotent — after the first pass every row
  // is already saved and `addSavedRepo` reports nothing added.
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
