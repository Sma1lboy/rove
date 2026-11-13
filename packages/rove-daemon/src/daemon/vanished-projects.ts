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
 *
 * Cost is two `stat`s of the root per project, never a walk, so project size
 * is irrelevant. The hazard is a hung mount: a `stat` there cannot be
 * cancelled and holds a libuv pool thread (4 by default) until the kernel
 * gives up. Hence one probe per path at a time, slow paths backing off, and
 * at most {@link MAX_IN_FLIGHT} probes outstanding overall.
 */

import { stat } from "node:fs/promises"
import { dirname } from "node:path"
import type { DaemonOrchestrator } from "./contracts.ts"
import { logDaemonError, logDaemonInfo } from "./crash-log.ts"
import { type PollCadenceConfig, type PollScheduleState, maybeStartScheduledRun } from "./poll-scheduling.ts"
import { startTicker } from "./ticker.ts"

export const DEFAULT_VANISHED_PROJECTS_TICK_MS = 30_000

const PROBE_CADENCE: PollCadenceConfig = {
  timeoutMs: 2_000,
  slowRetryMs: 10 * 60_000,
  minIntervalMs: DEFAULT_VANISHED_PROJECTS_TICK_MS,
}

// ponytail: hung probes count against the cap until the kernel returns them, so two hung
// mounts pause the sweep entirely; that beats starving the daemon's other fs work.
const MAX_IN_FLIGHT = 2

type ProjectOrch = Pick<DaemonOrchestrator, "listTasks" | "forgetProject">

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() === true
}

/** The checkout is gone while its parent is still there (gone WITH its parent = an unmounted volume). */
export async function checkoutVanished(path: string): Promise<boolean> {
  if (await isDirectory(path)) return false
  return isDirectory(dirname(path))
}

/** One sweep function, stateful across calls: each call starts the probes that are due. */
export function createVanishedProjectsSweep(
  orch: ProjectOrch,
  probe: (path: string) => Promise<boolean> = checkoutVanished,
): () => void {
  const states = new Map<string, PollScheduleState>()
  const inFlight = () => [...states.values()].filter((s) => s.inFlight).length
  return () => {
    const listed = new Set<string>()
    for (const task of orch.listTasks()) {
      if (task.kind !== "main" || task.repo.startsWith("ssh://")) continue
      const path = task.worktreePath || task.repo
      listed.add(path)
      if (inFlight() >= MAX_IN_FLIGHT) continue
      const state = states.get(path) ?? { inFlight: false, nextAllowedAt: 0 }
      states.set(path, state)
      const repo = task.repo
      maybeStartScheduledRun(
        state,
        PROBE_CADENCE,
        () => probe(path),
        (gone) => {
          if (!gone) return
          orch
            .forgetProject(repo)
            .then(() => logDaemonInfo("vanished-projects", `forgot ${repo}: its checkout is gone`))
            .catch((err) => logDaemonError("vanished-projects", err))
        },
      )
    }
    // A hung probe keeps its entry so the cap still counts it.
    for (const [path, state] of states) if (!listed.has(path) && !state.inFlight) states.delete(path)
  }
}

/** Ungated: the row is wrong whether or not a client watches, and the
 *  immediate pass is what cleans up after a restart. */
export function startVanishedProjectsSweeper(
  orch: ProjectOrch,
  tickMs = DEFAULT_VANISHED_PROJECTS_TICK_MS,
): () => Promise<void> {
  return startTicker({ name: "vanished-projects", tickMs, immediate: true, run: createVanishedProjectsSweep(orch) })
}
