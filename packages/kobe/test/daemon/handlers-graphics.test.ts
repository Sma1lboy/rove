/**
 * `graphics.write` — the daemon half of the graphics transport.
 *
 * What is worth pinning here is the two facts the verb exists to supply,
 * because a pane can supply neither for itself and both fail SILENTLY when
 * they are wrong.
 *
 * The IMAGE ID is namespaced per tab: two panes each picking their own would
 * both pick 1, and the second picture would replace the first in a terminal
 * store that neither pane can see. So a fresh id is never reused across tabs,
 * and a tab may only write to an id it was actually given.
 *
 * The CELL SIZE has no honest single value when two attached terminals
 * disagree — a task can be open in two GUIs at different font sizes — and
 * inventing one would place the picture wrong in at least one of them. The
 * verb refuses instead, and refuses BEFORE allocating, so a refusal does not
 * burn an id on a picture that will never be placed.
 */

import { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { GraphicsImageIds } from "@sma1lboy/kobe-daemon/daemon/graphics-ids"
import { agreedCellSize } from "@sma1lboy/kobe-daemon/daemon/handlers-graphics"
import { handleSubscribe } from "@sma1lboy/kobe-daemon/daemon/subscribe"
import { describe, expect, it } from "vitest"
import { TASK, dispatch, fakeCtx } from "./handler-test-context.ts"

const PAYLOAD = Buffer.from("not a real picture, and nothing here parses it").toString("base64")

function ctxWithTask(extra: Record<string, unknown> = {}) {
  return fakeCtx({ getTask: (id: string) => (id === TASK.id ? TASK : undefined), ...extra })
}

describe("GraphicsImageIds", () => {
  it("never hands the same id to two tabs", () => {
    const ids = new GraphicsImageIds()
    const a = ids.allocate("t1", "tab-1")
    const b = ids.allocate("t1", "tab-2")
    const c = ids.allocate("t2", "tab-1")
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it("lets a tab claim only the ids it was given", () => {
    const ids = new GraphicsImageIds()
    const mine = ids.allocate("t1", "tab-1")
    expect(ids.owns("t1", "tab-1", mine)).toBe(true)
    expect(ids.owns("t1", "tab-2", mine)).toBe(false)
    expect(ids.owns("t1", "tab-1", mine + 1000)).toBe(false)
  })

  it("forgets a closed tab's ids", () => {
    const ids = new GraphicsImageIds()
    const mine = ids.allocate("t1", "tab-1")
    ids.clearTab("t1", "tab-1")
    expect(ids.owns("t1", "tab-1", mine)).toBe(false)
  })
})

describe("agreedCellSize", () => {
  it("answers the one size when every attached terminal reports it", () => {
    expect(
      agreedCellSize([
        { width: 16, height: 34 },
        { width: 16, height: 34 },
      ]),
    ).toEqual({ cell: { width: 16, height: 34 } })
  })

  it("refuses when nobody could measure, and when two terminals disagree", () => {
    expect(agreedCellSize([])).toEqual({ unsupported: "no-cell-size" })
    expect(
      agreedCellSize([
        { width: 16, height: 34 },
        { width: 8, height: 17 },
      ]),
    ).toEqual({ unsupported: "mixed-cell-size" })
  })
})

describe("graphics.write", () => {
  it("allocates an id, publishes the bytes verbatim, and reports the cell size", async () => {
    const { ctx, rec } = ctxWithTask()
    const result = (await dispatch(
      "graphics.write",
      {
        taskId: TASK.id,
        tabId: "tab-3",
        data: PAYLOAD,
      },
      ctx,
    )) as Record<string, unknown>

    expect(result.ok).toBe(true)
    expect(result.cellWidth).toBe(16)
    expect(result.cellHeight).toBe(34)
    expect(typeof result.imageId).toBe("number")

    const published = rec.published.filter((p) => p.channel === "graphics.write")
    expect(published).toHaveLength(1)
    const payload = published[0]?.payload as Record<string, unknown>
    // Byte-for-byte: the whole contract is that Rove forwards and never reads.
    expect(payload.data).toBe(PAYLOAD)
    expect(payload.tabId).toBe("tab-3")
    expect(payload.imageId).toBe(result.imageId)
  })

  it("allocates and measures with no payload — the call a caller has to make first", async () => {
    // A virtual placement carries its image id inside the payload, so there is
    // no first frame to send until an id exists. This call is that step, and
    // it must broadcast nothing: there are no bytes to write yet.
    const { ctx, rec } = ctxWithTask()
    const result = (await dispatch("graphics.write", { taskId: TASK.id, tabId: "tab-3" }, ctx)) as Record<
      string,
      unknown
    >
    expect(result).toMatchObject({ ok: true, wrote: false, cellWidth: 16, cellHeight: 34 })
    expect(typeof result.imageId).toBe("number")
    expect(rec.published.filter((p) => p.channel === "graphics.write")).toHaveLength(0)

    // And the id it handed out is usable straight away.
    const wrote = (await dispatch(
      "graphics.write",
      { taskId: TASK.id, tabId: "tab-3", data: PAYLOAD, imageId: result.imageId },
      ctx,
    )) as Record<string, unknown>
    expect(wrote).toMatchObject({ ok: true, wrote: true, imageId: result.imageId })
    expect(rec.published.filter((p) => p.channel === "graphics.write")).toHaveLength(1)
  })

  it("reuses an id the same tab already holds, so a repainting pane does not leak one per frame", async () => {
    const { ctx, rec } = ctxWithTask()
    const first = (await dispatch(
      "graphics.write",
      {
        taskId: TASK.id,
        tabId: "tab-3",
        data: PAYLOAD,
      },
      ctx,
    )) as { imageId: number }
    const again = (await dispatch(
      "graphics.write",
      {
        taskId: TASK.id,
        tabId: "tab-3",
        data: PAYLOAD,
        imageId: first.imageId,
      },
      ctx,
    )) as { imageId: number }
    expect(again.imageId).toBe(first.imageId)
    expect(rec.published.filter((p) => p.channel === "graphics.write")).toHaveLength(2)
  })

  it("refuses an id belonging to another tab", async () => {
    const { ctx } = ctxWithTask()
    const mine = (await dispatch(
      "graphics.write",
      {
        taskId: TASK.id,
        tabId: "tab-3",
        data: PAYLOAD,
      },
      ctx,
    )) as { imageId: number }
    await expect(
      dispatch("graphics.write", { taskId: TASK.id, tabId: "tab-9", data: PAYLOAD, imageId: mine.imageId }, ctx),
    ).rejects.toThrow(/not allocated to this tab/)
  })

  it("reports unsupported — and publishes nothing — when no terminal measured a cell", async () => {
    const { ctx, rec } = ctxWithTask({ guiCellSizes: [] })
    const result = (await dispatch(
      "graphics.write",
      {
        taskId: TASK.id,
        tabId: "tab-3",
        data: PAYLOAD,
      },
      ctx,
    )) as Record<string, unknown>
    expect(result).toMatchObject({ ok: false, unsupported: "no-cell-size" })
    expect(result.imageId).toBeUndefined()
    expect(rec.published.filter((p) => p.channel === "graphics.write")).toHaveLength(0)
  })

  it("reports unsupported when two attached terminals disagree about the cell", async () => {
    const { ctx, rec } = ctxWithTask({
      guiCellSizes: [
        { width: 16, height: 34 },
        { width: 8, height: 17 },
      ],
    })
    const result = (await dispatch(
      "graphics.write",
      {
        taskId: TASK.id,
        tabId: "tab-3",
        data: PAYLOAD,
      },
      ctx,
    )) as Record<string, unknown>
    expect(result).toMatchObject({ ok: false, unsupported: "mixed-cell-size" })
    expect(rec.published.filter((p) => p.channel === "graphics.write")).toHaveLength(0)
  })

  it("rejects an unknown task and a payload that is not base64", async () => {
    const { ctx } = ctxWithTask()
    await expect(dispatch("graphics.write", { taskId: "nope", tabId: "tab-3", data: PAYLOAD }, ctx)).rejects.toThrow(
      /task not found/,
    )
    await expect(
      dispatch("graphics.write", { taskId: TASK.id, tabId: "tab-3", data: "not base64!!" }, ctx),
    ).rejects.toThrow(/base64/)
  })

  it("frees a tab's ids when the TUI reports the tab closed", async () => {
    const { ctx, rec } = ctxWithTask()
    const mine = (await dispatch(
      "graphics.write",
      {
        taskId: TASK.id,
        tabId: "tab-3",
        data: PAYLOAD,
      },
      ctx,
    )) as { imageId: number }
    await dispatch("ui.reportEvent", { kind: "tab.closed", taskId: TASK.id, detail: { tabId: "tab-3" } }, ctx)
    expect(rec.clearedTabs).toContainEqual({ taskId: TASK.id, tabId: "tab-3" })
    await expect(
      dispatch("graphics.write", { taskId: TASK.id, tabId: "tab-3", data: PAYLOAD, imageId: mine.imageId }, ctx),
    ).rejects.toThrow(/not allocated to this tab/)
  })
})

describe("cell pixel size, client to daemon", () => {
  it("survives the wire: what the client sends is what subscribe records", async () => {
    // The two halves are written in different packages and agree only by
    // field name — `cellPixelWidth`/`cellPixelHeight`. A rename on either side
    // silently degrades every graphics call to `unsupported`, which reads as
    // "this terminal has no graphics" rather than as a bug. So the real
    // builder feeds the real reader here, with nothing hand-written between.
    const client = new KobeDaemonClient("/tmp/never-connected.sock")
    let sent: Record<string, unknown> = {}
    // biome-ignore lint/suspicious/noExplicitAny: stubbing one method on a real instance
    ;(client as any).request = async (_name: string, payload: Record<string, unknown>) => {
      sent = payload
      return {}
    }
    await client.subscribe({ role: "gui", cellPixelSize: { width: 16, height: 34 } })

    const recorded = { id: 1, subscribed: false, holdsLifetime: false, channels: null, cellPixelSize: null }
    handleSubscribe(recorded, sent, {
      // biome-ignore lint/suspicious/noExplicitAny: only the client mutation is under test
      bus: { snapshot: () => [] } as any,
      // biome-ignore lint/suspicious/noExplicitAny: only the client mutation is under test
      activity: { replaySnapshot: () => [] } as any,
      // biome-ignore lint/suspicious/noExplicitAny: only the client mutation is under test
      lifetime: { guiAttached: () => {}, guiCount: () => 1 } as any,
      clientCount: () => 1,
      writeEvent: () => {},
    })
    expect(recorded.cellPixelSize).toEqual({ width: 16, height: 34 })
  })

  it("records nothing for a pane, whose tty is not a terminal", async () => {
    const recorded = { id: 1, subscribed: false, holdsLifetime: false, channels: null, cellPixelSize: null }
    handleSubscribe(
      recorded,
      { role: "pane", cellPixelWidth: 16, cellPixelHeight: 34 },
      {
        // biome-ignore lint/suspicious/noExplicitAny: only the client mutation is under test
        bus: { snapshot: () => [] } as any,
        // biome-ignore lint/suspicious/noExplicitAny: only the client mutation is under test
        activity: { replaySnapshot: () => [] } as any,
        // biome-ignore lint/suspicious/noExplicitAny: only the client mutation is under test
        lifetime: { guiAttached: () => {}, guiCount: () => 0 } as any,
        clientCount: () => 1,
        writeEvent: () => {},
      },
    )
    expect(recorded.cellPixelSize).toBeNull()
  })
})
