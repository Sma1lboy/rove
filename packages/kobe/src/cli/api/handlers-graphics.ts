/**
 * `rove api pane-graphics` — hand opaque graphics bytes to every attached TUI
 * to write to its own terminal, and learn the two numbers a pane cannot
 * measure for itself: the image id and the cell pixel size.
 *
 * Product-neutral by design, exactly like the daemon verb underneath it: this
 * reads stdin and forwards it. It has no idea whether the bytes draw a photo,
 * a chart or a web page, and nothing here may ever grow one.
 */

import { F } from "./flags.ts"
import { daemonOf, simpleRpc } from "./handler-helpers.ts"
import { resolveActiveTaskId } from "./runtime.ts"
import { ApiError, type VerbSpec } from "./types.ts"

/** Read all of stdin as bytes. `< image.png` is the whole intended calling convention. */
async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

export const PANE_GRAPHICS_VERB: VerbSpec = {
  name: "pane-graphics",
  group: "drive",
  summary:
    "Write opaque graphics bytes (read from stdin) to the terminal of every TUI attached to this task — the transport a pane needs because its own tty is a PTY slave, not the emulator, so it cannot reach the real terminal or measure it. Rove parses nothing: the bytes are your protocol. Call it ONCE with nothing on stdin to be given `imageId` (allocated per tab, so two panes never collide) plus `cellWidth`/`cellHeight` in pixels; build your payload around those, then pipe each frame in with --image-id to replace that picture in place. `wrote` says whether anything was broadcast. Returns `ok: false` with `unsupported` when no attached terminal reported a cell size (`no-cell-size`) or two reported different ones (`mixed-cell-size`) — fall back to whatever you draw without graphics. Task defaults to $ROVE_TASK_ID, then the active task.",
  flags: [
    F.taskId(false),
    {
      name: "tab",
      type: "string",
      required: true,
      placeholder: "TAB",
      description: "Terminal Tab whose cells the picture is for (e.g. tab-3), from get-task .tabs[].id.",
    },
    {
      name: "image-id",
      type: "int",
      placeholder: "N",
      description:
        "Reuse an id this tab was already given, replacing that picture in place. Omit to be handed a fresh one.",
    },
  ],
  handler: async (ctx) => {
    // Same resolution order (and same MISSING_TARGET rejection) as the other
    // pane verbs — an agent that has one of them has all of them.
    const client = daemonOf(ctx)
    const taskId = ctx.args.str("task-id") ?? process.env.KOBE_TASK_ID ?? (await resolveActiveTaskId(client))
    if (!taskId) {
      throw new ApiError("no target task: pass --task-id (no $ROVE_TASK_ID, no active task)", "MISSING_TARGET")
    }
    // Nothing piped in = the allocate-and-measure call. That is the FIRST
    // call any caller makes, because a virtual placement carries its image id
    // inside the payload: you cannot build the bytes until you have the id.
    const data = process.stdin.isTTY ? Buffer.alloc(0) : await readStdin()
    const imageId = ctx.args.int("image-id")
    return simpleRpc(ctx, "graphics.write", {
      taskId,
      tabId: ctx.args.require("tab"),
      ...(data.length > 0 ? { data: data.toString("base64") } : {}),
      ...(imageId !== undefined ? { imageId } : {}),
    })
  },
}
