/**
 * `rove api viewers` and `rove api panel-show` at the daemon: what the `ui.viewing` registry says
 * about each screen, what `panel.show` broadcasts, and who it reports as showing it.
 */

import { RowStatusStore } from "@sma1lboy/rove-daemon/daemon/row-status-store"
import type { DaemonHandlerContext } from "@sma1lboy/rove-daemon/daemon/server"
import { afterEach, describe, expect, it } from "vitest"
import { TASK, dispatch, fakeCtx } from "./handler-test-context.ts"

interface Reply {
  shown: number
  remembered: number
  viewers: Array<Record<string, unknown>>
  url?: { reachable: boolean; frameable: boolean; reason?: string }
}

const stores: RowStatusStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

function harness() {
  const { ctx, rec } = fakeCtx({ getTask: (id: string) => (id === "t1" ? TASK : undefined) })
  const store = new RowStatusStore({
    bus: { publish: () => {}, onPublish: () => () => {}, snapshot: () => [] },
    listSessions: async () => null,
    readEpisode: async () => undefined,
    anyGui: () => false,
  })
  stores.push(store)
  const withStore: DaemonHandlerContext = { ...ctx, rowStatus: store }
  return { ctx: withStore, rec, store }
}

/** One browser behind the bridge: the named viewer, with what the bridge and the page reported. */
const web = (
  store: RowStatusStore,
  clientId: number,
  viewer: string,
  taskId: string,
  fields: Record<string, unknown>,
) => dispatch("ui.viewing", { viewer, taskId, ...fields }, { ...fakeCtx().ctx, clientId, rowStatus: store })

describe("viewers", () => {
  it("a TUI is a local screen without a panel; a client that sends no fields still registers", async () => {
    const { ctx, store } = harness()
    store.setViewing(3, "", "t1", "tab-1")
    await dispatch("ui.viewing", { viewer: "bridge-9", taskId: "t1" }, ctx)
    const { viewers } = (await dispatch("ui.viewers", {}, ctx)) as Reply
    expect(viewers).toEqual([
      { viewer: "tui-3", taskId: "t1", tabId: "tab-1", surface: "tui", panel: false, local: true },
      { viewer: "bridge-9", taskId: "t1", surface: "web", panel: false, local: false },
    ])
  })

  it("keeps the layout a web page reported, drops a panel claim from a phone, and filters by task", async () => {
    const { ctx, store } = harness()
    await dispatch(
      "ui.viewing",
      { viewer: "bridge-1", taskId: "t1", surface: "web", local: true, panel: true, panelOpen: false, narrow: false },
      ctx,
    )
    await dispatch("ui.viewing", { viewer: "bridge-2", taskId: "t1", surface: "phone", local: false, panel: true }, ctx)
    await web(store, 8, "bridge-3", "other", { surface: "web", local: true, panel: true })
    const forT1 = ((await dispatch("ui.viewers", { taskId: "t1" }, ctx)) as Reply).viewers
    expect(forT1).toEqual([
      { viewer: "bridge-1", taskId: "t1", surface: "web", panel: true, panelOpen: false, narrow: false, local: true },
      { viewer: "bridge-2", taskId: "t1", surface: "phone", panel: false, local: false },
    ])
    expect(((await dispatch("ui.viewers", {}, ctx)) as Reply).viewers).toHaveLength(3)
  })

  it("a screen that shows no task, or whose connection closed, is gone", async () => {
    const { ctx, store } = harness()
    await dispatch("ui.viewing", { viewer: "bridge-1", taskId: "t1", surface: "web", local: true }, ctx)
    await web(store, 8, "bridge-2", "t1", { surface: "web", local: true })
    await dispatch("ui.viewing", { viewer: "bridge-1", taskId: null }, ctx)
    store.dropClient(8)
    expect(((await dispatch("ui.viewers", {}, ctx)) as Reply).viewers).toEqual([])
  })
})

describe("panel.show", () => {
  it("broadcasts the view, and counts the pages that open it now and the ones that remember it", async () => {
    const { ctx, rec, store } = harness()
    await dispatch("ui.viewing", { viewer: "bridge-1", taskId: "t1", surface: "web", local: true, panel: true }, ctx)
    await web(store, 8, "bridge-2", "t1", { surface: "web", local: true, panel: false, narrow: true })
    await web(store, 9, "bridge-3", "other", { surface: "web", local: true, panel: true })
    store.setViewing(4, "", "t1", null)
    const before = Date.now()
    const reply = (await dispatch("panel.show", { taskId: "t1", view: "files", path: "src/./a.ts" }, ctx)) as Reply
    expect(reply.shown).toBe(1)
    expect(reply.remembered).toBe(3)
    expect(reply.viewers.map((v) => v.viewer)).toEqual(["bridge-1", "bridge-2", "tui-4"])
    expect(reply.url).toBeUndefined()
    const event = rec.published.find((e) => e.channel === "panel.show")?.payload as Record<string, unknown>
    expect(event).toMatchObject({ taskId: "t1", view: "files", path: "src/a.ts" })
    expect(event.at as number).toBeGreaterThanOrEqual(before)
  })

  it("a localhost page is unreachable while any viewing page is remote", async () => {
    const { ctx, store } = harness()
    const show = async () =>
      ((await dispatch("panel.show", { taskId: "t1", view: "browser", url: "http://localhost:3000/x" }, ctx)) as Reply)
        .url
    expect(await show()).toEqual({ reachable: true, frameable: true })
    await dispatch("ui.viewing", { viewer: "bridge-1", taskId: "t1", surface: "web", local: false, panel: true }, ctx)
    expect(await show()).toMatchObject({ reachable: false, frameable: false })
    await web(store, 8, "bridge-2", "t1", { surface: "web", local: true, panel: true })
    expect(await show()).toMatchObject({ reachable: false })
    store.dropClient(7)
    expect(await show()).toEqual({ reachable: true, frameable: true })
  })

  it("an https page at a private address is refused before any connection", async () => {
    const { ctx } = harness()
    const reply = (await dispatch(
      "panel.show",
      { taskId: "t1", view: "browser", url: "https://10.0.0.1/" },
      ctx,
    )) as Reply
    expect(reply.url).toMatchObject({ reachable: false, frameable: false })
    expect(reply.url?.reason).toMatch(/refused.*10\.0\.0\.1/)
  })

  it("plain http is framed for localhost only", async () => {
    const { ctx } = harness()
    const reply = (await dispatch(
      "panel.show",
      { taskId: "t1", view: "browser", url: "http://example.com/" },
      ctx,
    )) as Reply
    expect(reply.url).toMatchObject({ frameable: false })
  })

  it.each([
    [{ view: "browser", url: "ftp://example.com" }, /http\(s\)/],
    [{ view: "browser", url: "javascript:alert(1)" }, /http\(s\)/],
    [{ view: "files", path: "../secrets" }, /without `\.\.`/],
    [{ view: "files", path: "a/../../b" }, /without `\.\.`/],
    [{ view: "diff", path: "/etc/passwd" }, /relative/],
    [{ view: "pdf" }, /view must be one of/],
    [{ view: "files", url: "https://example.com" }, /browser view only/],
    [{ view: "browser", path: "a.ts" }, /files and diff/],
  ])("refuses %j", async (payload, message) => {
    const { ctx, rec } = harness()
    await expect(dispatch("panel.show", { taskId: "t1", ...payload }, ctx)).rejects.toThrow(message)
    expect(rec.published).toEqual([])
  })

  it("an unknown task is an error", async () => {
    const { ctx } = harness()
    await expect(dispatch("panel.show", { taskId: "nope", view: "diff" }, ctx)).rejects.toThrow(/task not found/)
  })
})
