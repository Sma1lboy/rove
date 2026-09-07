import { TabCloseBroker } from "@sma1lboy/kobe-daemon/daemon/tab-close-broker"
import { describe, expect, it } from "vitest"
import { TASK, dispatch, fakeCtx } from "./handler-test-context.ts"

/**
 * The broker's negative-acknowledgement rule: "false acknowledgements do not
 * pre-empt another TUI". Several TUIs can be attached to one daemon, and the
 * one that answers first is not necessarily the one holding the tab — so a
 * reply of "I did not close it" has to leave the request open for a client
 * with fresher state, and only a confirmed close settles it.
 *
 * Deleting the `if (!closed)` guard left all three test tracks green. The only
 * reply `handlers.test.ts` ever sent was `{ closed: true }`, and
 * `handlers-ui.ts`'s `optionalBoolean(payload, "closed") ?? false` means a
 * reply that OMITS the field takes the same never-exercised path — so a TUI
 * saying "no" would have settled the waiter as a successful close.
 *
 * Both levels are covered here: the class in isolation, and the wire path
 * through `terminalTab.closeReply` that produces the `?? false`.
 */
describe("TabCloseBroker", () => {
  it("a false acknowledgement is accepted but settles nothing", async () => {
    const broker = new TabCloseBroker()
    const pending = broker.create("req-1", 10_000)
    const unsettled = Symbol("still-pending")

    // Accepted — the request id is known — but the waiter stays open.
    expect(broker.settle("req-1", false)).toBe(true)
    expect(await Promise.race([pending, Promise.resolve(unsettled)])).toBe(unsettled)

    expect(broker.settle("req-1", true)).toBe(true)
    expect(await pending).toBe(true)
    // …and the settled request is gone, so a late duplicate is not accepted.
    expect(broker.settle("req-1", true)).toBe(false)
    broker.clear()
  })

  it("an unknown request id is rejected either way", () => {
    const broker = new TabCloseBroker()
    expect(broker.settle("never-created", true)).toBe(false)
    expect(broker.settle("never-created", false)).toBe(false)
  })

  it("a TUI that did not close the tab leaves the request open for one that did", async () => {
    const { ctx, rec } = fakeCtx({ getTask: () => TASK })
    const pending = dispatch("terminalTab.close", { taskId: "t1", tabId: "tab-3" }, ctx)
    const requestId = (rec.published[0] as { payload: Record<string, unknown> }).payload.requestId as string
    const unsettled = Symbol("still-pending")

    // A stale TUI answers first, and answers no.
    expect(await dispatch("terminalTab.closeReply", { requestId, closed: false }, ctx)).toEqual({ ok: true })
    expect(await Promise.race([pending, Promise.resolve(unsettled)])).toBe(unsettled)

    // Same for a reply that omits `closed` entirely — `?? false` routes it
    // through the identical branch.
    expect(await dispatch("terminalTab.closeReply", { requestId }, ctx)).toEqual({ ok: true })
    expect(await Promise.race([pending, Promise.resolve(unsettled)])).toBe(unsettled)

    // The TUI with fresher state still gets to answer.
    expect(await dispatch("terminalTab.closeReply", { requestId, closed: true }, ctx)).toEqual({ ok: true })
    expect(await pending).toEqual({ ok: true, handled: true })
  })
})
