/**
 * `rove api list` across machines. A no-op when no machine is registered: the
 * daemon's own response OBJECT comes back, so single-machine output is
 * byte-identical. Verbs aimed at a remote task are forwarded (`forward.ts`).
 */

import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { machineTasks } from "./forward.ts"
import { dedupeMachines, listMachines } from "./registry.ts"

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
