/**
 * Forget a project whose checkout is gone from disk. The folder was deleted or
 * moved, so its sidebar/rail row and picker entry point at nothing: `forget`
 * drops the index entry only (disk is never touched), and `rove add` brings it
 * back if the directory returns.
 *
 * Local `kind:"main"` rows only: a remote (`ssh://`) project lives on another
 * host, where a local stat says nothing.
 *
 * The PARENT must still exist. A missing parent means the path is unreachable,
 * not deleted — an unmounted volume makes every project under it look gone —
 * so those rows stay for the remount.
 */

import { stat } from "node:fs/promises"
import { dirname } from "node:path"
import type { DaemonOrchestrator } from "./contracts.ts"
import { logDaemonInfo } from "./crash-log.ts"
import { startTicker } from "./ticker.ts"

export const DEFAULT_VANISHED_PROJECTS_TICK_MS = 10_000

type ProjectOrch = Pick<DaemonOrchestrator, "listTasks" | "forgetProject">

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() === true
}

/** One pass: repos whose row was forgotten. */
export async function forgetVanishedProjects(orch: ProjectOrch): Promise<string[]> {
  const forgotten: string[] = []
  for (const task of orch.listTasks()) {
    if (task.kind !== "main" || task.repo.startsWith("ssh://")) continue
    const path = task.worktreePath || task.repo
    if (await isDirectory(path)) continue
    // Gone with its parent = the volume is not mounted; it may come back.
    if (!(await isDirectory(dirname(path)))) continue
    await orch.forgetProject(task.repo)
    forgotten.push(task.repo)
  }
  return forgotten
}

/** Ungated: the row is wrong whether or not a client watches, and the
 *  immediate pass is what cleans up after a restart. */
export function startVanishedProjectsSweeper(
  orch: ProjectOrch,
  tickMs = DEFAULT_VANISHED_PROJECTS_TICK_MS,
): () => Promise<void> {
  return startTicker({
    name: "vanished-projects",
    tickMs,
    immediate: true,
    run: async () => {
      for (const repo of await forgetVanishedProjects(orch))
        logDaemonInfo("vanished-projects", `forgot ${repo}: its checkout is gone`)
    },
  })
}
