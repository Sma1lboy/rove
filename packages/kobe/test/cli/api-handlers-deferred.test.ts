/**
 * The `deferred-*` verbs — the headless half of the Inbox.
 *
 * A `send` into a busy composer hands the text to the daemon and exits 0. With
 * a human attached, they release it from the Inbox. With nobody attached there
 * was no verb that could: the prompt was swept 24h later, undelivered, while
 * every send to that tab refused with `DEFERRED_PROMPT_PENDING`.
 *
 * What these verbs must NOT do is flatten the outcomes into each other, which
 * is the whole reason a caller could not act on the old payload. Four
 * different things can happen to a release — it landed, the gate blocked it
 * again, someone else owns the record, the record is gone — and they call for
 * four different next moves. Each is asserted separately here.
 */

import { describe, expect, it } from "vitest"
import { ApiError, invokeVerb } from "../../src/cli/api-cmd.ts"
import { FakeClient, expectApiError, stubRuntime } from "./api-handler-fixtures.ts"

const RECORD = {
  id: "rec-1",
  taskId: "t1",
  tabId: "tab-1",
  prompt: "second message",
  layer: "recent-human-write",
  at: "2026-09-04T11:42:52.407Z",
  expiresAt: "2026-09-05T11:42:52.407Z",
}

/** A `deferredPrompt.release` report with the claimed-and-delivered shape. */
function releaseReport(over: Record<string, unknown> = {}) {
  return { kind: "claimed", delivered: [], cleaned: [], expired: [], retained: [], cleanupPending: [], ...over }
}

describe("deferred-list", () => {
  it("returns what the daemon holds, expiry included", async () => {
    const client = new FakeClient({ "deferredPrompt.list": () => ({ records: [RECORD] }) })
    const result = (await invokeVerb("deferred-list", [], { client, runtime: stubRuntime() })) as {
      records: (typeof RECORD)[]
    }
    // `expiresAt` is the field that makes the record actionable rather than
    // decorative: it is the deadline after which the text is swept undelivered.
    expect(result.records).toEqual([RECORD])
  })

  it("filters to one task", async () => {
    const other = { ...RECORD, id: "rec-2", taskId: "t2" }
    const client = new FakeClient({ "deferredPrompt.list": () => ({ records: [RECORD, other] }) })
    const result = (await invokeVerb("deferred-list", ["--task-id", "t2"], { client, runtime: stubRuntime() })) as {
      records: (typeof RECORD)[]
    }
    expect(result.records.map((r) => r.id)).toEqual(["rec-2"])
  })
})

describe("deferred-release", () => {
  it("reports delivered:true only when the daemon says the paste landed", async () => {
    const client = new FakeClient({
      "deferredPrompt.release": () => releaseReport({ delivered: ["rec-1"], cleaned: ["rec-1"] }),
    })
    expect(await invokeVerb("deferred-release", ["--id", "rec-1"], { client, runtime: stubRuntime() })).toEqual({
      ok: true,
      id: "rec-1",
      delivered: true,
    })
    expect(client.requests[0]).toEqual({ name: "deferredPrompt.release", payload: { id: "rec-1" } })
  })

  it("a composer that is STILL busy retains the record — not delivered, not lost", async () => {
    // The release re-runs the gate rather than bypassing it. The caller's next
    // move is to retry the RELEASE later, never to re-send the text: the
    // daemon still owns it, and a second send would refuse anyway.
    const client = new FakeClient({
      "deferredPrompt.release": () =>
        releaseReport({
          retained: [{ id: "rec-1", taskId: "t1", tabId: "tab-1", reason: "busy", layer: "composer-not-empty" }],
        }),
    })
    expect(await invokeVerb("deferred-release", ["--id", "rec-1"], { client, runtime: stubRuntime() })).toEqual({
      ok: true,
      id: "rec-1",
      delivered: false,
      reason: "busy",
      layer: "composer-not-empty",
    })
  })

  it("an in-flight claim is a wait, not a failure", async () => {
    // The daemon's own flush already owns the record. The claim is what
    // prevents a double paste, so retrying is safe — reporting this as an
    // error would push a caller toward re-sending the text instead.
    const client = new FakeClient({ "deferredPrompt.release": () => releaseReport({ kind: "in-flight" }) })
    expect(await invokeVerb("deferred-release", ["--id", "rec-1"], { client, runtime: stubRuntime() })).toEqual({
      ok: true,
      id: "rec-1",
      delivered: false,
      reason: "in-flight",
    })
  })

  it("an id the daemon no longer holds is typed, with the list as its recovery", async () => {
    const client = new FakeClient({ "deferredPrompt.release": () => releaseReport({ kind: "missing" }) })
    try {
      await invokeVerb("deferred-release", ["--id", "gone"], { client, runtime: stubRuntime() })
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      const err = error as ApiError
      expect(err.code).toBe("DEFERRED_PROMPT_NOT_FOUND")
      expect(err.data?.nextCommandArgs).toEqual(["api", "deferred-list"])
    }
  })
})

describe("deferred-dismiss", () => {
  it("drops the record and says so", async () => {
    const client = new FakeClient({ "deferredPrompt.dismiss": () => ({ dismissed: true, record: RECORD }) })
    expect(await invokeVerb("deferred-dismiss", ["--id", "rec-1"], { client, runtime: stubRuntime() })).toMatchObject({
      dismissed: true,
    })
  })

  it("refuses loud when nothing was dropped", async () => {
    // `{dismissed:false}` returned as success would tell a caller its tab's
    // slot is free when it is not — the next send would still refuse.
    const client = new FakeClient({ "deferredPrompt.dismiss": () => ({ dismissed: false }) })
    await expectApiError(
      () => invokeVerb("deferred-dismiss", ["--id", "gone"], { client, runtime: stubRuntime() }),
      "DEFERRED_PROMPT_NOT_FOUND",
    )
  })
})
