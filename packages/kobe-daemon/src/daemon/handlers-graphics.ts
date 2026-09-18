/**
 * The `graphics.write` RPC — hand opaque graphics bytes to every attached GUI
 * to write to its own tty.
 *
 * Its own file rather than a tenth entry in `handlers-ui.ts` because it is its
 * own wire namespace, which is how that family is split (see its header).
 *
 * Shaped exactly like `tab.open`: the daemon validates and publishes, and an
 * attached TUI performs the real work. What it adds is the one fact a pane
 * cannot supply for itself, because neither belongs to it:
 *
 *   - the IMAGE ID, whose number space belongs to the terminal, so two panes
 *     picking their own would overwrite each other ({@link GraphicsImageIds});
 *   - the CELL PIXEL SIZE, which is a measurement of the surface the pane's
 *     cells land on — a pane's own tty is its PTY slave, which knows nothing
 *     about it.
 *
 * Product-neutral, and it stays that way: nothing here parses, validates or
 * names the payload's content. An image viewer, a chart pane and a browser all
 * ride this one verb.
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
 *
 * Disagreement is a real state, not an edge case: a task can be attached by
 * more than one GUI, in terminals at different font sizes. There is no honest
 * single answer then, and inventing one (the first, the smallest, an average)
 * would place every picture wrong in at least one of them — so the caller is
 * told, and falls back to whatever it does without graphics.
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
      // `data` is OPTIONAL, and that is the primary entry point rather than a
      // convenience: a virtual placement carries its image id INSIDE the
      // payload, so a caller has to be given an id before it can build one.
      // A call with no data allocates and reports the geometry, publishing
      // nothing; every frame after that names the id it was given.
      const data = optionalString(payload, "data")
      if (!ctx.orch.getTask(taskId)) throw new Error(`task not found: ${taskId}`)
      const ids = ctx.graphics
      if (!ids) throw new Error("graphics unavailable")
      // Shape-only validation. The bytes are never decoded here — the point of
      // the verb is that Rove does not know what they are — but a payload that
      // is not base64 at all could only ever arrive mangled at the terminal,
      // and failing on the way in beats a picture that silently never draws.
      if (data !== undefined) {
        if (!BASE64.test(data)) throw new Error("data must be base64")
        const bytes = Math.floor((data.length * 3) / 4)
        if (bytes > MAX_GRAPHICS_BYTES) {
          throw new Error(`payload too large: ${bytes} bytes (max ${MAX_GRAPHICS_BYTES})`)
        }
      }

      const agreed = agreedCellSize(ctx.daemon.guiCellSizes?.() ?? [])
      if ("unsupported" in agreed) {
        // Nothing is allocated and nothing is published: a caller that cannot
        // be told the cell size cannot compute the cells to cover, so sending
        // the payload anyway would burn an id on a picture with no placement.
        return { ok: false, unsupported: agreed.unsupported, clients: ctx.daemon.clientCount() }
      }

      // An id the caller already holds is REUSED, which is how a repainting
      // pane replaces its picture in place instead of leaking a fresh id per
      // frame. Ownership is checked so one pane cannot overwrite another's —
      // the namespacing is the whole reason the id is allocated here.
      const reuse = (payload as { imageId?: unknown }).imageId
      let imageId: number
      if (reuse === undefined) {
        imageId = ids.allocate(taskId, tabId)
      } else {
        imageId = requireNumber(payload, "imageId")
        if (!ids.owns(taskId, tabId, imageId)) throw new Error(`imageId not allocated to this tab: ${imageId}`)
      }

      if (data !== undefined) ctx.bus.publish("graphics.write", { taskId, tabId, imageId, data, at: Date.now() })
      // Same reach report as `tab.open`: the write is performed by an attached
      // TUI, so `clients` (raw CONNECTION count, the calling CLI included) is
      // the only signal that anyone could have performed it.
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
