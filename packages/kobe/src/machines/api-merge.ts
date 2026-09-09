/**
 * `rove api` across machines, PR 1: merged READS, refused writes.
 *
 * Two entry points, both no-ops when no machine is registered — which is the
 * regression guard the whole feature is built around. `mergeTaskList` hands
 * back the daemon's own response OBJECT when there is nothing to merge, so
 * `rove api list` on a single-machine install prints the bytes it always did.
 *
 * Reaching a machine from the CLI means dialing the forwarded socket that a
 * TUI's {@link import("./hub").MachineHub} keeps alive. A CLI process does not
 * start tunnels of its own: it is short-lived, and spawning an ssh master per
 * `rove api list` would be a connection storm. So a machine whose socket is
 * not there right now is simply reported as offline — the same thing the
 * sidebar says.
 */

import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import type { SerializedTask } from "@sma1lboy/kobe-daemon/daemon/protocol"
import { ApiError } from "../cli/api/types.ts"
import { listMachines } from "./registry.ts"
import { localDaemonSocketPath } from "./ssh-args.ts"

/**
 * Refusal for a verb aimed at a task on another machine.
 *
 * An {@link ApiError} so it travels in the same `{error:{message,code,…}}`
 * envelope every other refusal uses, carrying the recovery command: the verb
 * is not wrong, only its address is.
 */
export function remoteTaskUnsupported(taskId: string, machineId: string): ApiError {
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

/**
 * Add every reachable machine's tasks to a local `task.list` response.
 *
 * Returns `local` UNCHANGED (same object) when no machine is registered.
 * Otherwise every task — local ones included — carries an `origin`, so a
 * consumer never has to read an absent field as "this one is local".
 */
export async function mergeTaskList(local: { tasks?: SerializedTask[] }): Promise<{ tasks: SerializedTask[] }> {
  const machines = listMachines()
  if (machines.length === 0) return local as { tasks: SerializedTask[] }
  const tasks: SerializedTask[] = (local.tasks ?? []).map((task) => ({
    ...task,
    origin: { machineId: "local", hostLabel: "local" },
  }))
  for (const entry of machines) {
    const remote = await tasksOf(localDaemonSocketPath(entry.alias))
    if (!remote) continue
    const hostLabel = entry.identity?.hostname || entry.alias
    for (const task of remote) tasks.push({ ...task, origin: { machineId: entry.alias, hostLabel } })
  }
  return { tasks }
}

/**
 * Refuse a verb aimed at a remote task instead of letting it land on the local
 * daemon, where the id simply does not exist.
 *
 * The distinction matters: a bare `TASK_NOT_FOUND` for a task the user can SEE
 * in the sidebar reads as data loss. Naming the machine says the task is fine
 * and the command is early.
 *
 * No machines registered → returns immediately without opening a socket, so
 * every existing verb pays nothing.
 */
export async function assertLocalTask(taskId: string | undefined): Promise<void> {
  if (!taskId) return
  const machines = listMachines()
  if (machines.length === 0) return
  for (const entry of machines) {
    const remote = await tasksOf(localDaemonSocketPath(entry.alias))
    if (!remote) continue
    if (remote.some((task) => task.id === taskId)) throw remoteTaskUnsupported(taskId, entry.alias)
  }
}
