/**
 * The `daemon.stopping` frame's REASON, over the real socket (protocol v5).
 *
 * A daemon shutting down and a daemon being REPLACED are the same event from a
 * client socket — the peer closed — and only the second one means the attached
 * TUI is about to be a build behind. Inferring it costs a reconnect plus a
 * `hello` under backoff; this frame is what lets the client know while the old
 * daemon is still on the wire.
 *
 * Driven end to end because the frame is written from a shutdown DEFERRAL,
 * after the last handler has run and while the sockets are being torn down —
 * the one place a unit test of the handler cannot reach, and the one place an
 * ordering mistake would silently send `{}` forever.
 */

import { afterEach, describe, expect, it } from "vitest"
import { CURRENT_VERSION } from "../../src/version.ts"
import { type DaemonHarness, bootDaemonHarness, waitFor } from "./harness.ts"

describe("daemon.stopping reason", () => {
  let h: DaemonHarness

  afterEach(async () => {
    await h.close().catch(() => {})
  })

  async function stoppingFrameFor(reason?: unknown): Promise<Record<string, unknown>> {
    h = await bootDaemonHarness()
    const client = h.client()
    const frames: Record<string, unknown>[] = []
    client.on("daemon.stopping", (frame) => frames.push((frame.payload ?? {}) as Record<string, unknown>))
    await client.subscribe()
    // Fire-and-forget: the daemon answers, THEN tears down on a later tick, so
    // awaiting the response would not (and must not) mean the frame has landed.
    void client.request("daemon.stop", reason === undefined ? {} : { reason }).catch(() => {})
    await waitFor(() => frames.length > 0)
    expect(frames).toHaveLength(1)
    return frames[0] as Record<string, unknown>
  }

  it("relays an explicit restart, with the outgoing build", async () => {
    const payload = await stoppingFrameFor("restart")
    expect(payload.reason).toBe("restart")
    // The version is the comparison the client would otherwise have to
    // reconnect to make.
    expect(payload.kobeVersion).toBe(CURRENT_VERSION)
  })

  it("an unlabelled stop stays a stop", async () => {
    // The default has to be the quiet one: a shutdown nobody labelled must
    // never read as "your code is being replaced", which is the only reason
    // that puts a refresh prompt in front of a user.
    expect((await stoppingFrameFor()).reason).toBe("stop")
  })

  it("a caller cannot claim a reason only the daemon may report", async () => {
    // `idle` and `socket-lost` describe the daemon's own decisions. Echoing a
    // caller's claim back onto the wire would let any CLI poke fabricate one.
    expect((await stoppingFrameFor("idle")).reason).toBe("stop")
    expect((await stoppingFrameFor("nonsense")).reason).toBe("stop")
  })
})
