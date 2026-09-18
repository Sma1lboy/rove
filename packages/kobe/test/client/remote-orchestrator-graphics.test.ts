/**
 * Client side of the graphics transport: the cell size going OUT with
 * `subscribe`, and the payload coming back IN on `graphics.write`.
 *
 * The outbound half is what makes the whole thing work at all — the daemon
 * cannot measure a cell, and every consumer of the verb reads the size back
 * from the subscribe the GUI made at boot. The inbound half is the one place
 * in the client that performs an ACT rather than storing a value, so the two
 * things pinned here are that the bytes arrive at the sink unchanged (Rove
 * parses nothing) and that only a `gui` attach writes: a pane's tty is its
 * own, and writing pictures to it would corrupt whatever it is showing.
 */

import type { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { describe, expect, it, vi } from "vitest"
import { RemoteOrchestrator } from "../../src/client/remote-orchestrator.ts"

const { logClientError } = vi.hoisted(() => ({ logClientError: vi.fn() }))
vi.mock("@sma1lboy/kobe-daemon/client/client-log", async (importActual) => ({
  ...(await importActual<typeof import("@sma1lboy/kobe-daemon/client/client-log")>()),
  logClientError,
}))

function fakeClient(): {
  client: KobeDaemonClient
  emit: (name: string, payload: unknown) => void
  subscribes: Array<Record<string, unknown>>
} {
  let star: ((frame: { name: string; payload: unknown }) => void) | undefined
  const subscribes: Array<Record<string, unknown>> = []
  const client = {
    on: (name: string, handler: (frame: { name: string; payload: unknown }) => void) => {
      if (name === "*") star = handler
      return () => {}
    },
    onLifecycle: () => () => {},
    request: async (name: string) =>
      name === "hello" ? { protocolVersion: 5, minProtocolVersion: 2, capabilities: [] } : {},
    subscribe: async (opts: Record<string, unknown>) => {
      subscribes.push(opts)
      return {}
    },
  } as unknown as KobeDaemonClient
  return { client, emit: (name, payload) => star?.({ name, payload }), subscribes }
}

const PICTURE = Buffer.from([0x1b, 0x5f, 0x47, 0x00, 0xff, 0x7f, 0x80])

describe("cell pixel size on subscribe", () => {
  it("sends the measured size as two flat numbers", async () => {
    const { client, subscribes } = fakeClient()
    const orch = new RemoteOrchestrator(client, { role: "gui", cellPixelSize: { width: 16, height: 34 } })
    await orch.init()
    expect(subscribes[0]).toMatchObject({ role: "gui", cellPixelSize: { width: 16, height: 34 } })
  })

  it("reports no size at all when the terminal declined to answer", async () => {
    // The daemon then answers `unsupported` rather than placing a picture at a
    // guessed size — so an absent measurement must stay absent, not become 0.
    const { client, subscribes } = fakeClient()
    const orch = new RemoteOrchestrator(client, { role: "gui" })
    await orch.init()
    expect(subscribes[0]?.cellPixelSize ?? null).toBeNull()
  })
})

describe("graphics.write events", () => {
  it("hands the payload to the sink byte-for-byte", async () => {
    const written: Buffer[] = []
    const { client, emit } = fakeClient()
    new RemoteOrchestrator(client, { role: "gui", graphicsOut: (d) => written.push(d) })
    emit("graphics.write", {
      taskId: "t1",
      tabId: "tab-3",
      imageId: 77,
      data: PICTURE.toString("base64"),
      at: Date.now(),
    })
    expect(written).toHaveLength(1)
    // High bytes and control bytes survive the base64 round trip intact — a
    // payload mangled here draws nothing, with no error anywhere to say so.
    expect(written[0]?.equals(PICTURE)).toBe(true)
  })

  it("writes every payload, never deduping — a picture is an act, not a state", async () => {
    const written: Buffer[] = []
    const { client, emit } = fakeClient()
    new RemoteOrchestrator(client, { role: "gui", graphicsOut: (d) => written.push(d) })
    const payload = { taskId: "t1", tabId: "tab-3", imageId: 77, data: PICTURE.toString("base64"), at: 1 }
    emit("graphics.write", payload)
    emit("graphics.write", payload)
    expect(written).toHaveLength(2)
  })

  it("drops a malformed payload with a log instead of writing garbage", async () => {
    logClientError.mockClear()
    const written: Buffer[] = []
    const { client, emit } = fakeClient()
    new RemoteOrchestrator(client, { role: "gui", graphicsOut: (d) => written.push(d) })
    emit("graphics.write", { taskId: "t1", tabId: "tab-3", at: 1 })
    emit("graphics.write", { data: "AAAA", imageId: "77", at: 1 })
    expect(written).toHaveLength(0)
    expect(logClientError).toHaveBeenCalledTimes(2)
  })

  it("a pane attach writes nothing — its tty is not the terminal a picture belongs on", async () => {
    // No `graphicsOut`, so the default sink applies: `gui` writes to its own
    // fd 1, a `pane` writes nowhere at all.
    const { client, emit } = fakeClient()
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true)
    try {
      new RemoteOrchestrator(client, { role: "pane" })
      emit("graphics.write", { taskId: "t1", tabId: "tab-3", imageId: 1, data: "AAAA", at: 1 })
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
