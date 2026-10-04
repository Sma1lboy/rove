/**
 * `graphics.write`: hand opaque graphics bytes to every attached GUI to write
 * to its own tty. Like `tab.open`, the daemon validates and publishes; an
 * attached TUI does the work. It adds what a pane can't supply itself:
 *
 *   - the IMAGE ID, whose number space is the terminal's, so panes picking
 *     their own would overwrite each other ({@link GraphicsImageIds});
 *   - the CELL PIXEL SIZE of the real surface; a pane's own tty is its PTY
 *     slave, which knows nothing about it.
 *
 * Product-neutral: nothing here parses or names the payload's content.
 */

import type { CellPixelSize } from "./channels-events.ts"
import { optionalString, requireNumber, requireString } from "./handler-validators.ts"
import type { DaemonRequestHandler } from "./handlers.ts"

/**
 * Cap on one payload, decoded. The socket's frame limit is 8 MiB and base64
 * inflates by a third, so this leaves room for the envelope while still
 * admitting a full-window screenshot.
 */
const MAX_GRAPHICS_BYTES = 4 * 1024 * 1024

/** Standard base64, with or without its padding. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * The one cell size every attached GUI agrees on, or why there isn't one.
 * GUIs at different font sizes have no honest single answer; inventing one
 * would misplace pictures in some, so the caller is told and falls back.
 */
export function agreedCellSize(
  sizes: readonly CellPixelSize[],
): { cell: CellPixelSize } | { unsupported: "no-cell-size" | "mixed-cell-size" } {
  const first = sizes[0]
  if (!first) return { unsupported: "no-cell-size" }
  for (const size of sizes) {
    if (size.width !== first.width || size.height !== first.height) return { unsupported: "mixed-cell-size" }
  }
  return { cell: first }
}

export const GRAPHICS_HANDLERS: readonly DaemonRequestHandler[] = [
  {
    name: "graphics.write",
    async handle(payload, ctx) {
      const taskId = requireString(payload, "taskId")
      const tabId = requireString(payload, "tabId")
      // `data` is OPTIONAL by design: a virtual placement carries its image id
      // INSIDE the payload, so a no-data call allocates an id and reports the
      // geometry, publishing nothing.
      const data = optionalString(payload, "data")
      if (!ctx.orch.getTask(taskId)) throw new Error(`task not found: ${taskId}`)
      const ids = ctx.graphics
      if (!ids) throw new Error("graphics unavailable")
      // Shape-only check, never decoded: non-base64 would only arrive mangled
      // at the terminal and silently never draw.
      if (data !== undefined) {
        if (!BASE64.test(data)) throw new Error("data must be base64")
        const bytes = Math.floor((data.length * 3) / 4)
        if (bytes > MAX_GRAPHICS_BYTES) {
          throw new Error(`payload too large: ${bytes} bytes (max ${MAX_GRAPHICS_BYTES})`)
        }
      }

      const agreed = agreedCellSize(ctx.daemon.guiCellSizes?.() ?? [])
      if ("unsupported" in agreed) {
        // Allocate and publish nothing: without a cell size the caller can't
        // compute a placement.
        return { ok: false, unsupported: agreed.unsupported, clients: ctx.daemon.clientCount() }
      }

      // A held id is REUSED so a repainting pane replaces in place instead of
      // leaking an id per frame; ownership stops one pane overwriting another's.
      const reuse = (payload as { imageId?: unknown }).imageId
      let imageId: number
      if (reuse === undefined) {
        imageId = ids.allocate(taskId, tabId)
      } else {
        imageId = requireNumber(payload, "imageId")
        if (!ids.owns(taskId, tabId, imageId)) throw new Error(`imageId not allocated to this tab: ${imageId}`)
      }

      if (data !== undefined) ctx.bus.publish("graphics.write", { taskId, tabId, imageId, data, at: Date.now() })
      // `clients` (raw CONNECTION count, calling CLI included) is the only
      // signal an attached TUI could have performed the write.
      return {
        ok: true,
        wrote: data !== undefined,
        imageId,
        cellWidth: agreed.cell.width,
        cellHeight: agreed.cell.height,
        clients: ctx.daemon.clientCount(),
      }
    },
  },
]
