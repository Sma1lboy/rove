/**
 * `rove api` across machines: merged READS, refused writes.
 *
 * Both entry points are no-ops when no machine is registered; `mergeTaskList`
 * then returns the daemon's own response OBJECT, so single-machine output is
 * byte-identical.
 */

import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { ApiError } from "../cli/api/types.ts"
import { type MachineEntry, dedupeMachines, listMachines } from "./registry.ts"
import { localDaemonSocketPath } from "./ssh-args.ts"
import { ensureForwards } from "./tunnel.ts"

/** An {@link ApiError} so it travels in the standard error envelope with a recovery command. */
function remoteTaskUnsupported(taskId: string, machineId: string): ApiError {
  return new ApiError(
    `task ${taskId} lives on machine "${machineId}". Rove can list it, but acting on a remote task is not supported yet.`,
    "NOT_YET_SUPPORTED_REMOTE",
    {
      taskId,
      machineId,
      hint: `run the command on ${machineId} itself; remote writes arrive in a later release`,
      nextCommandArgs: ["machine", "list"],
    },
  )
}

/**
 * A machine's tasks, bringing up its forward first if nothing listens. The
 * forward rides the shared ssh connection, so only the first call after a
 * quiet period pays a connect. Unreachable → null (reported offline).
 */
async function machineTasks(entry: MachineEntry): Promise<SerializedTask[] | null> {
  const socketPath = localDaemonSocketPath(entry.alias)
  const direct = await tasksOf(socketPath)
  if (direct) return direct
  if (!entry.sockets) return null
  const up = await ensureForwards({
    alias: entry.alias,
    config: entry,
    remoteDaemonSocket: entry.sockets.daemon,
    remotePtySocket: entry.sockets.pty,
  })
  return up ? await tasksOf(socketPath) : null
}

async function tasksOf(socketPath: string): Promise<SerializedTask[] | null> {
  const client = new KobeDaemonClient(socketPath)
  try {
    await client.request("hello", {})
    const res = await client.request<{ tasks?: SerializedTask[] }>("task.list")
    return res.tasks ?? []
  } catch {
    return null
  } finally {
    client.close()
  }
}

/** With machines registered every task, local ones included, carries an `origin`. */
export async function mergeTaskList(local: { tasks?: SerializedTask[] }): Promise<{ tasks: SerializedTask[] }> {
  // Same dedupe as the sidebar, so the two surfaces agree on the machine count.
  const machines = dedupeMachines(listMachines())
  if (machines.length === 0) return local as { tasks: SerializedTask[] }
  const tasks: SerializedTask[] = (local.tasks ?? []).map((task) => ({
    ...task,
    origin: { machineId: "local", hostLabel: "local" },
  }))
  for (const entry of machines) {
    const remote = await machineTasks(entry)
    if (!remote) continue
    // The alias, not the hostname — see `MachineStatus.hostLabel`.
    const hostLabel = entry.alias
    for (const task of remote) tasks.push({ ...task, origin: { machineId: entry.alias, hostLabel } })
  }
  return { tasks }
}

/**
 * Refuse a verb aimed at a remote task: a bare `TASK_NOT_FOUND` for a task the
 * user can SEE in the sidebar reads as data loss. No machines → returns
 * without opening a socket.
 */
export async function assertLocalTask(taskId: string | undefined): Promise<void> {
  if (!taskId) return
  const machines = dedupeMachines(listMachines())
  if (machines.length === 0) return
  for (const entry of machines) {
    const remote = await machineTasks(entry)
    if (!remote) continue
    if (remote.some((task) => task.id === taskId)) throw remoteTaskUnsupported(taskId, entry.alias)
  }
}
