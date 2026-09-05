import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type ActivityObserverIo, startActivityObserver } from "@sma1lboy/kobe-daemon/daemon/activity-observer"
import { DaemonActivityRegistry } from "@sma1lboy/kobe-daemon/daemon/activity-registry"
import { createProtocolUpgradeReporter } from "@sma1lboy/kobe-daemon/daemon/collectors"
import { DaemonEventBus } from "@sma1lboy/kobe-daemon/daemon/event-bus"
import { defaultPtyExitsPath, defaultPtyHostSocketPath } from "@sma1lboy/kobe-daemon/daemon/paths"
import { readPtyExitRecords } from "@sma1lboy/kobe-daemon/daemon/pty-exit-store"
import { describe, expect, it, vi } from "vitest"
import { createActivityObserverIo } from "../../../kobe-daemon/src/daemon/activity-observer-io.ts"
import { fakeOrchestrator } from "./harness.ts"

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
const session = { key: "task::tab-1", alive: true, pid: 10, title: "working", totalBytes: 10 }
const engines = new Map([[10, { vendor: "codex", pid: 11 }]])
function observer(overrides: Partial<ActivityObserverIo> = {}) {
  const activity = new DaemonActivityRegistry(new DaemonEventBus())
  const setCommand = vi.fn(async () => {})
  const onEngineEvidence = createProtocolUpgradeReporter(
    fakeOrchestrator({ getTask: () => ({ vendor: "generic" }), setCommand }),
    {
      resolveProtocolUpgrade: () => ({ vendor: "codex", command: "wrapper" }),
    },
  )
  const stop = startActivityObserver(
    activity,
    {
      listSessions: async () => [session],
      foregroundEngines: async () => engines,
      titleTurnHint: () => "working",
      onEngineEvidence,
      ...overrides,
    },
    () => true,
    { pollMs: 100_000 },
  )
  return {
    stop: async () => {
      await stop()
      activity.close()
    },
    setCommand,
  }
}

describe("observer shutdown before releasing the daemon home", () => {
  it("does not start protocol writes after a delayed inventory resolves during stop", async () => {
    const list = deferred<readonly (typeof session)[]>()
    const { stop, setCommand } = observer({ listSessions: () => list.promise })
    const closing = stop()
    list.resolve([session])
    await closing
    expect(setCommand).not.toHaveBeenCalled()
  })

  it("does not start protocol writes after a delayed foreground walk resolves during stop", async () => {
    const walked = deferred<void>()
    const walk = deferred<typeof engines>()
    const { stop, setCommand } = observer({
      foregroundEngines: () => {
        walked.resolve()
        return walk.promise
      },
    })
    await walked.promise
    const closing = stop()
    walk.resolve(engines)
    await closing
    expect(setCommand).not.toHaveBeenCalled()
  })

  it("waits for an already-started protocol update", async () => {
    const started = deferred<void>()
    const written = deferred<void>()
    const setCommand = vi.fn(() => {
      started.resolve()
      return written.promise
    })
    const report = createProtocolUpgradeReporter(
      fakeOrchestrator({ getTask: () => ({ vendor: "generic" }), setCommand }),
      {
        resolveProtocolUpgrade: () => ({ vendor: "codex", command: "wrapper" }),
      },
    )
    const { stop } = observer({ onEngineEvidence: report })
    await started.promise
    let closed = false
    const closing = stop().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    written.resolve()
    await closing
    expect(setCommand).toHaveBeenCalledTimes(1)
  })

  it("waits for the boot death-record callback before closing", async () => {
    const started = deferred<void>()
    const written = deferred<void>()
    const { stop } = observer({
      foregroundEngines: async () => new Map([[10, null]]),
      onEngineAbsentAtStart: () => {
        started.resolve()
        return written.promise
      },
    })
    await started.promise
    let closed = false
    const closing = stop().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    written.resolve()
    await closing
    expect(closed).toBe(true)
  })

  it.each(["boot", "exit"])("drains the production %s death record after a delayed socket peek", async (edge) => {
    const home = await mkdtemp(join(tmpdir(), "rove-observer-drain-"))
    await mkdir(join(home, ".rove"))
    const peeked = deferred<void>()
    const tail = deferred<void>()
    const host = createServer((socket) => {
      let buffer = ""
      socket.on("data", (chunk) => {
        buffer += chunk.toString()
        const at = buffer.indexOf("\n")
        if (at < 0) return
        const frame = JSON.parse(buffer.slice(0, at))
        buffer = buffer.slice(at + 1)
        peeked.resolve()
        void tail.promise.then(() => {
          socket.write(
            `${JSON.stringify({
              type: "response",
              id: frame.id,
              name: frame.name,
              payload: { data: Buffer.from("Engine exited (code 143).").toString("base64") },
            })}\n`,
          )
        })
      })
    })
    await new Promise<void>((resolve) => host.listen(defaultPtyHostSocketPath(home), resolve))
    const activity = new DaemonActivityRegistry(new DaemonEventBus())
    let walks = 0
    const io = createActivityObserverIo(
      home,
      {
        foregroundEngines: async () => (edge === "exit" && walks++ === 0 ? engines : new Map([[10, null]])),
        titleTurnHint: () => null,
      },
      activity,
    )
    const stop = startActivityObserver(activity, { ...io, listSessions: async () => [session] }, () => true, {
      pollMs: 5,
      walkEveryTicks: 1,
    })
    try {
      await peeked.promise
      let closed = false
      const closing = stop().then(() => {
        closed = true
      })
      await Promise.resolve()
      expect(closed).toBe(false)
      expect(readPtyExitRecords(defaultPtyExitsPath(home))).toEqual({})
      tail.resolve()
      await closing
      expect(readPtyExitRecords(defaultPtyExitsPath(home))["task::tab-1#engine"]).toMatchObject({ code: 143 })
    } finally {
      tail.resolve()
      await stop()
      activity.close()
      await new Promise<void>((resolve) => host.close(() => resolve()))
      await rm(home, { recursive: true, force: true })
    }
  })
})
