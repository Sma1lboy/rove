/**
 * Unit tests for the daemon session boilerplate (`cli/daemon-session.ts`):
 * connect-or-start vs require-running mode selection, and the one
 * guarantee callers lean on — the socket is closed on EVERY exit path
 * (success, thrown error, absent daemon). A leaked socket from a
 * short-lived `kobe api` process would pin the daemon's connection table,
 * so close-on-error is load-bearing, not cosmetic.
 */

import { type MockInstance, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  connectOrStartDaemon: vi.fn(),
  connectIfRunning: vi.fn(),
}))

vi.mock("@sma1lboy/kobe-daemon/client/daemon-process", () => mocks)

import type { KobeDaemonClient } from "@sma1lboy/kobe-daemon/client"
import { openDaemonSession, resolveActiveTaskId, withDaemonSession } from "../../src/cli/daemon-session.ts"

function fakeClient(): KobeDaemonClient & { close: ReturnType<typeof vi.fn> } {
  return { close: vi.fn() } as unknown as KobeDaemonClient & { close: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  mocks.connectOrStartDaemon.mockReset()
  mocks.connectIfRunning.mockReset()
})

describe("openDaemonSession", () => {
  it("default mode connects via connect-or-start and close() closes the client", async () => {
    const client = fakeClient()
    mocks.connectOrStartDaemon.mockResolvedValue(client)
    const session = await openDaemonSession()
    expect(mocks.connectIfRunning).not.toHaveBeenCalled()
    expect(session.client).toBe(client)
    session.close()
    expect(client.close).toHaveBeenCalledTimes(1)
  })

  it("require-running mode never spawns and resolves null when no daemon answers", async () => {
    mocks.connectIfRunning.mockResolvedValue(null)
    const session = await openDaemonSession({ mode: "require-running" })
    expect(session).toBeNull()
    expect(mocks.connectOrStartDaemon).not.toHaveBeenCalled()
  })

  it("propagates a connect-or-start failure to the caller", async () => {
    mocks.connectOrStartDaemon.mockRejectedValue(new Error("daemon did not start"))
    await expect(openDaemonSession()).rejects.toThrow("daemon did not start")
  })
})

describe("withDaemonSession", () => {
  it("closes the socket after successful work and returns its value", async () => {
    const client = fakeClient()
    mocks.connectOrStartDaemon.mockResolvedValue(client)
    const result = await withDaemonSession(async (c) => {
      expect(c).toBe(client)
      expect(client.close).not.toHaveBeenCalled()
      return 42
    })
    expect(result).toBe(42)
    expect(client.close).toHaveBeenCalledTimes(1)
  })

  it("closes the socket even when work throws", async () => {
    const client = fakeClient()
    mocks.connectOrStartDaemon.mockResolvedValue(client)
    await expect(
      withDaemonSession(async () => {
        throw new Error("handler exploded")
      }),
    ).rejects.toThrow("handler exploded")
    expect(client.close).toHaveBeenCalledTimes(1)
  })

  it("require-running mode runs work with null when the daemon is absent", async () => {
    mocks.connectIfRunning.mockResolvedValue(null)
    const seen: unknown[] = []
    await withDaemonSession(
      async (c) => {
        seen.push(c)
      },
      { mode: "require-running" },
    )
    expect(seen).toEqual([null])
  })
})

describe("resolveActiveTaskId", () => {
  function fakeClient(activeId: string | null): KobeDaemonClient & {
    onChannel: MockInstance
    subscribe: MockInstance
  } {
    const onChannel = vi.fn((channel, handler) => {
      if (channel === "active-task" && activeId !== null) handler({ taskId: activeId })
      return vi.fn()
    })
    const subscribe = vi.fn().mockResolvedValue(undefined)
    return { onChannel, subscribe } as unknown as KobeDaemonClient & {
      onChannel: MockInstance
      subscribe: MockInstance
    }
  }

  it("returns the active task id replayed on the active-task channel", async () => {
    const client = fakeClient("task-123")
    expect(await resolveActiveTaskId(client)).toBe("task-123")
    expect(client.subscribe).toHaveBeenCalled()
  })

  it("returns null when the channel reports no active task", async () => {
    const client = fakeClient(null)
    expect(await resolveActiveTaskId(client)).toBeNull()
  })

  it("unsubscribes from the channel even if subscribe throws", async () => {
    const off = vi.fn()
    const client = {
      onChannel: vi.fn(() => off),
      subscribe: vi.fn().mockRejectedValue(new Error("socket closed")),
    } as unknown as KobeDaemonClient
    await expect(resolveActiveTaskId(client)).rejects.toThrow("socket closed")
    expect(off).toHaveBeenCalledTimes(1)
  })
})
