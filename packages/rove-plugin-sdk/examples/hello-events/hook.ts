/**
 * One event → one JSONL line in $ROVE_PLUGIN_STATE_DIR/events.jsonl.
 *
 * In-repo the SDK import resolves through the workspace root's node_modules;
 * an out-of-tree copy needs `bun add @sma1lboy/rove-plugin-sdk` first.
 */
import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { pluginContext, pluginEvent } from "@sma1lboy/rove-plugin-sdk"

const ctx = pluginContext()
const ev = pluginEvent()
if (ev) {
  appendFileSync(
    join(ctx.stateDir, "events.jsonl"),
    `${JSON.stringify({ event: ev.event, taskId: ev.taskId, detail: ev.detail, at: ev.at })}\n`,
  )
  console.log(`hello-events: ${ev.event}${ev.taskId ? ` (task ${ev.taskId})` : ""}`)
}
