/**
 * `task.spawn`'s `commandFrom`: start the new task on the launch command another task already carries
 * (Retry keeps a task's custom `--command`). The string is read from that task on this Mac and never
 * comes from the client, so it stays inside the rule that a phone authors no command the Mac runs.
 */

import { BridgeError } from "../protocol.ts"
import { flag, taskId } from "./args.ts"
import type { Args, OpContext } from "./types.ts"

/** The source task's raw launch command, or null when `commandFrom` is absent. Refuses every shape it can't honour. */
export async function commandFromTask(
  args: Args,
  ctx: OpContext,
  where: { engine: string | undefined; machine: string | undefined; parallel: boolean },
): Promise<string | null> {
  if (args.commandFrom === undefined || args.commandFrom === null || args.commandFrom === "") return null
  const id = taskId(args, "commandFrom")
  if (where.machine) throw new BridgeError("BAD_ARGS", "commandFrom needs a task on this machine")
  if (where.parallel) throw new BridgeError("BAD_ARGS", "commandFrom conflicts with count and agents")
  if (!where.engine) throw new BridgeError("BAD_ARGS", "commandFrom needs the engine the source task runs")
  if (ctx.api.machineOf?.(id)) throw new BridgeError("BAD_ARGS", "commandFrom needs a task on this machine")
  const { task } = await ctx.api.verb<{ task: { vendor?: string; command?: string } }>("get-task", [
    flag("task-id", id),
  ])
  if (task.vendor !== where.engine) {
    throw new BridgeError("BAD_ARGS", "commandFrom is only for the engine that task runs; pick that engine or drop it")
  }
  return task.command ?? null
}
