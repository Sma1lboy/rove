import { describe, expect, it } from "vitest"
import { CURRENT_VERSION } from "../../src/version.ts"
import { TASK, dispatch, fakeCtx } from "./handler-test-context.ts"

/**
 * The daemon-PROCESS verbs — `daemon.status` and `daemon.stop`.
 *
 * Split out of `handlers.test.ts` (the 500-line cap) along a real seam: these
 * two report and control the daemon PROCESS, while everything left behind
 * moves task or UI state. They also have the one contract in the registry that
 * is about trust rather than shape — `daemon.stop` decides what an outgoing
 * daemon is allowed to tell every attached client about WHY it is going away,
 * and a client that believes "restart" tears its own UI down and starts over.
 */

describe("daemon process surface", () => {
  it("daemon.status reports the ctx-provided facts in the wire shape", async () => {
    const { ctx } = fakeCtx({ listTasks: () => [TASK] })
    const status = (await dispatch("daemon.status", {}, ctx)) as Record<string, unknown>
    expect(status.daemonPid).toBe(4242)
    expect(status.attachedClients).toBe(1)
    expect(status.taskCount).toBe(1)
    expect(status.socketPath).toBe("/tmp/fake/daemon.sock")
    expect(status.startedAt).toBe("2026-06-01T00:00:00.000Z")
    expect(status.uptimeMs).toBeGreaterThanOrEqual(0)
    expect(status.kobeVersion).toBe(CURRENT_VERSION)
  })

  it("daemon.stop drives stopSoon and returns the empty object", async () => {
    const { ctx, rec } = fakeCtx()
    await expect(dispatch("daemon.stop", {}, ctx)).resolves.toEqual({})
    expect(rec.stopped).toBe(1)
    // No reason given is a plain stop — the daemon never claims on a
    // caller's behalf that its code is about to be replaced.
    expect(rec.stopReasons).toEqual(["stop"])
  })

  it("only an explicit `restart` reason survives into the stopping broadcast", async () => {
    // `restart` is the one reason that changes what an attached TUI does
    // (it offers to relaunch itself), so it is the one reason a caller has
    // to ask for by name. Everything else — an unknown string, an idle or
    // socket-lost claim that only the daemon itself may make — collapses to
    // a plain stop rather than being echoed back onto the wire.
    for (const [given, expected] of [
      ["restart", "restart"],
      ["idle", "stop"],
      ["socket-lost", "stop"],
      ["please-upgrade", "stop"],
      [42, "stop"],
    ] as const) {
      const { ctx, rec } = fakeCtx()
      await expect(dispatch("daemon.stop", { reason: given }, ctx)).resolves.toEqual({})
      expect(rec.stopReasons).toEqual([expected])
    }
  })
})
