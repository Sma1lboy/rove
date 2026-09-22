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
})
