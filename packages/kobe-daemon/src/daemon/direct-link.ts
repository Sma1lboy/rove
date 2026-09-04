/**
 * The daemon's in-process RPC link.
 *
 * This is the object the automation runner uses to launch engine sessions:
 * the same handler registry the socket serves, dispatched without a socket
 * round-trip. It is built unconditionally at daemon start because a routine
 * has to be able to run whether or not anyone is watching.
 *
 * It used to live in `web-server.ts` alongside the browser dashboard's
 * HTTP/SSE listener, which is why its type is still named after the web. The
 * dashboard is gone; the link is not, because it never belonged to it — the
 * listener merely reused it.
 */

import type { DaemonRpcClient } from "../client/rpc.ts"
import type { DaemonActivityRegistry } from "./activity-registry.ts"
import type { DaemonOrchestrator } from "./contracts.ts"
import type { DaemonEventBus } from "./event-bus.ts"
import { type DaemonHandlerContext, createDaemonHandlerRegistry, dispatchDaemonRequest } from "./handlers.ts"
import type { ChannelName, ChannelPayloads, DaemonRequestName, SerializedTask } from "./protocol.ts"
import { serializeTask } from "./protocol.ts"

/** The full state a fresh consumer needs in one read. */
export interface DaemonSnapshotState {
  tasks: SerializedTask[]
  activeTaskId: string | null
  engineStates: ReturnType<DaemonActivityRegistry["snapshotByTask"]>
  update: ChannelPayloads["update"]["info"] | null
  jobs: Record<string, ChannelPayloads["task.jobs"]>
  worktreeChanges: ChannelPayloads["worktree.changes"]["changes"]
  issueSnapshots: Record<string, ChannelPayloads["issue.snapshot"]>
  deliver: ChannelPayloads["session.deliver"] | null
  uiPrefs: ChannelPayloads["ui-prefs"] | null
  connected: boolean
}

/** An RPC client that can also hand over the current snapshot. */
export interface DaemonDirectLink extends DaemonRpcClient {
  snapshot(): DaemonSnapshotState
}

function latest<C extends ChannelName>(bus: DaemonEventBus, channel: C): ChannelPayloads[C] | null {
  const found = bus.snapshot().find((event) => event.channel === channel)
  return found ? (found.payload as ChannelPayloads[C]) : null
}

function normalizeRepoPath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path
}

/**
 * Every path that names the same repo. A task's `repo` and `worktreePath` can
 * both address one issue store, so a snapshot keyed by only one of them would
 * read as empty from the other.
 */
function repoSnapshotAliases(tasks: readonly SerializedTask[], repoRoot: string): string[] {
  const root = normalizeRepoPath(repoRoot)
  const aliases = new Set<string>([repoRoot])
  for (const task of tasks) {
    const taskRepo = normalizeRepoPath(task.repo)
    const taskWorktree = normalizeRepoPath(task.worktreePath)
    if (taskRepo === root || taskWorktree === root) {
      if (task.repo) aliases.add(task.repo)
      if (task.worktreePath) aliases.add(task.worktreePath)
    }
  }
  return [...aliases]
}

export function createDirectLink(args: {
  orch: DaemonOrchestrator
  bus: DaemonEventBus
  activity: DaemonActivityRegistry
  ctx: (clientId: number) => DaemonHandlerContext
}): DaemonDirectLink {
  const handlers = createDaemonHandlerRegistry()
  return {
    async request<T>(name: DaemonRequestName, payload?: unknown): Promise<T> {
      return (await dispatchDaemonRequest(handlers, name, payload, args.ctx(0))) as T
    },
    snapshot(): DaemonSnapshotState {
      const tasks = args.orch.listTasks().map(serializeTask)
      const issueSnapshots: Record<string, ChannelPayloads["issue.snapshot"]> = {}
      const issue = latest(args.bus, "issue.snapshot")
      if (issue) {
        for (const alias of repoSnapshotAliases(tasks, issue.repoRoot))
          issueSnapshots[alias] = { ...issue, repoRoot: alias }
      }
      const job = latest(args.bus, "task.jobs")
      const jobs: Record<string, ChannelPayloads["task.jobs"]> = job?.phase === "running" ? { [job.taskId]: job } : {}
      return {
        tasks,
        activeTaskId: latest(args.bus, "active-task")?.taskId ?? null,
        engineStates: args.activity.snapshotByTask(),
        update: latest(args.bus, "update")?.info ?? null,
        jobs,
        worktreeChanges: latest(args.bus, "worktree.changes")?.changes ?? {},
        issueSnapshots,
        deliver: latest(args.bus, "session.deliver"),
        uiPrefs: latest(args.bus, "ui-prefs"),
        connected: true,
      }
    },
  }
}
