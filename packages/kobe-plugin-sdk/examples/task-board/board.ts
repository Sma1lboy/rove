/**
 * Live pane entrypoint: subscribe to task snapshots and engine activity, then
 * draw a board where each row shows a task's engine glyph + status glyph.
 */
import { Pane, RoveSocket } from "@sma1lboy/rove-plugin-sdk"
import { type BoardTask, type EngineState, frame } from "./frame.ts"

const pane = new Pane()
const daemon = new RoveSocket()
await daemon.connect()

let tasks: BoardTask[] = []
const engineStates: Record<string, string> = {}

function redraw() {
  pane.draw(frame(tasks, engineStates, pane.cols))
}

await daemon.subscribe(
  (name, payload) => {
    if (name === "task.snapshot") {
      tasks = ((payload as { tasks?: BoardTask[] }).tasks ?? []).slice()
      redraw()
    } else if (name === "engine-state") {
      const ev = payload as EngineState
      if (ev.taskId && ev.state) {
        engineStates[ev.taskId] = ev.state
        redraw()
      }
    }
  },
  ["task.snapshot", "engine-state"],
)

pane.start()
pane.onKey((key) => {
  if (key.name === "q") pane.exit(0)
})
pane.onResize(redraw)
redraw()
