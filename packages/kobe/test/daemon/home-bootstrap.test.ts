import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startDaemonServer } from "@sma1lboy/kobe-daemon/daemon/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { daemonRuntime } from "../../src/core/daemon-runtime.ts"
import { fakeOrchestrator } from "./harness.ts"

describe("daemon bootstrap ownership", () => {
  let homeDir: string
  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "rove-bootstrap-"))
  })
  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true })
  })
  const options = () => ({
    homeDir,
    runtime: daemonRuntime,
    socketPath: join(homeDir, "daemon.sock"),
    pidPath: join(homeDir, "daemon.pid"),
    updatePollMs: 0,
    autoTitlePollMs: 0,
    prStatusPollMs: 0,
    uiPrefsDebounceMs: 0,
    keybindingsDebounceMs: 0,
    worktreeChangesTickMs: 0,
    transcriptActivityTickMs: 0,
  })

  it("calls only one factory while a concurrent boot is still initializing", async () => {
    let entered = () => {}
    const entry = new Promise<void>((resolve) => {
      entered = resolve
    })
    let finish = () => {}
    const ready = new Promise<void>((resolve) => {
      finish = resolve
    })
    const factory = vi.fn(async () => {
      entered()
      await ready
      return fakeOrchestrator()
    })
    const first = startDaemonServer(factory, options())
    await entry
    const rejectedFactory = vi.fn(fakeOrchestrator)
    await expect(
      startDaemonServer(rejectedFactory, { ...options(), socketPath: join(homeDir, "other.sock") }),
    ).rejects.toThrow("exclusive ownership")
    expect(rejectedFactory).not.toHaveBeenCalled()
    finish()
    const server = await first
    await server.close()
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it("releases after a factory failure and after a throwing stop hook", async () => {
    await expect(
      startDaemonServer(() => {
        throw new Error("factory failed")
      }, options()),
    ).rejects.toThrow("factory failed")
    const server = await startDaemonServer(fakeOrchestrator, {
      ...options(),
      onStop: () => {
        throw new Error("stop failed")
      },
    })
    await Promise.all([server.close(), server.close()])
    const replacement = await startDaemonServer(fakeOrchestrator, options())
    await replacement.close()
  })

  it("unwinds initialized stores when later bootstrap fails", async () => {
    await expect(
      startDaemonServer(
        () =>
          fakeOrchestrator({
            subscribeTasks: () => {
              throw new Error("subscription failed")
            },
          }),
        options(),
      ),
    ).rejects.toThrow("subscription failed")
    const server = await startDaemonServer(fakeOrchestrator, options())
    await server.close()
    await expect(readFile(join(homeDir, ".rove", "daemon.owner"))).rejects.toThrow()
  })
})
