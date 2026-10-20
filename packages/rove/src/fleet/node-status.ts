/**
 * What a worker tells a center about itself: capacity, load, engines, the
 * repos it can cut worktrees from, and the tags it offers. Collected inside
 * the machine's own daemon (`rove api node-status`), so every figure is that
 * machine's, never the caller's.
 */

import { cpus, freemem, hostname, loadavg, totalmem } from "node:os"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import type { DaemonRpc } from "../cli/daemon-session.ts"
import { listHostedSessionsOrNull, openHostedSessionHost } from "../engine/hosted-session.ts"
import { persistedMaxLiveEngines } from "../state/engine-limit.ts"
import { getSavedRepos } from "../state/repos.ts"
import { CURRENT_VERSION } from "../version.ts"
import { readFleetConfig } from "./config.ts"
import { readRepoRemote } from "./repo-remote.ts"

export interface NodeRepo {
  readonly path: string
  /** Normalized `origin` ({@link normalizeRemoteUrl}); absent for a repo with none. */
  readonly remote?: string
}

export interface NodeStatus {
  readonly hostname: string
  readonly version: string
  readonly platform: string
  readonly cpus: number
  /** 1-minute load average; 0 on platforms that do not report one. */
  readonly loadAvg1: number
  readonly memFreeRatio: number
  /** Live hosted PTY sessions; null when the PTY host could not be asked. */
  readonly liveSessions: number | null
  /** `engine.maxLiveSessions`; absent = no cap. */
  readonly maxLiveSessions?: number
  readonly tasks: number
  readonly engines: readonly string[]
  readonly tags: readonly string[]
  readonly description: string
  readonly repos: readonly NodeRepo[]
}

async function countLiveSessions(): Promise<number | null> {
  const host = await openHostedSessionHost()
  if (!host) return null
  try {
    const sessions = await listHostedSessionsOrNull(host.rpc)
    return sessions ? sessions.filter((s) => s.alive).length : null
  } finally {
    host.close()
  }
}

/** Saved repos plus every repo a live task came from, each once. */
async function knownRepos(tasks: readonly SerializedTask[]): Promise<NodeRepo[]> {
  const paths = [...new Set([...getSavedRepos(), ...tasks.filter((t) => t.kind !== "dir").map((t) => t.repo)])]
  return Promise.all(
    paths.map(async (path) => {
      const remote = await readRepoRemote(path)
      return remote ? { path, remote } : { path }
    }),
  )
}

export async function collectNodeStatus(
  client: DaemonRpc,
  engines: () => Promise<readonly string[]>,
): Promise<NodeStatus> {
  const [{ tasks = [] }, liveSessions, engineIds] = await Promise.all([
    client.request<{ tasks?: SerializedTask[] }>("task.list"),
    countLiveSessions(),
    engines(),
  ])
  const fleet = readFleetConfig()
  const maxLiveSessions = persistedMaxLiveEngines()
  const total = totalmem()
  return {
    hostname: hostname(),
    version: CURRENT_VERSION,
    platform: process.platform,
    cpus: Math.max(1, cpus().length),
    loadAvg1: loadavg()[0] ?? 0,
    memFreeRatio: total > 0 ? freemem() / total : 0,
    liveSessions,
    ...(maxLiveSessions !== undefined ? { maxLiveSessions } : {}),
    tasks: tasks.length,
    engines: engineIds,
    tags: fleet.tags,
    description: fleet.description,
    repos: await knownRepos(tasks),
  }
}
