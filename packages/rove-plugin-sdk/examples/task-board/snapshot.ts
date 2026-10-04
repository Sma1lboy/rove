/**
 * Headless action: connect to the daemon, request the current task list, print
 * one board frame, and exit. Used to verify the board renderer without a TUI.
 */
import { RoveSocket, pluginContext } from "@sma1lboy/rove-plugin-sdk"
import { type BoardTask, frame } from "./frame.ts"

interface TaskListResponse {
  readonly tasks: BoardTask[]
}

const ctx = pluginContext()
const daemon = new RoveSocket()
await daemon.connect({ socketPath: ctx.socketPath })

const reply = await daemon.request<TaskListResponse>("task.list")
for (const line of frame(reply.tasks, {}, 80)) {
  console.log(line)
}

daemon.close()
process.exit(0)
