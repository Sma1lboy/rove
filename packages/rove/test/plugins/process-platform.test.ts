import { ChildProcess } from "node:child_process"
import { PassThrough } from "node:stream"
import { type MockInstance, afterEach, describe, expect, it, vi } from "vitest"
import { runPluginHook } from "../../../rove-daemon/src/plugins/hook-run.ts"
import { ModHost } from "../../../rove-daemon/src/plugins/mod-host.ts"

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }))
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  ...mocks,
}))
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
}))
vi.mock("../../../rove-daemon/src/daemon/log-rotate.ts", () => ({ rotateLogIfNeeded: vi.fn() }))

const pid = 123456
function childProcess() {
  const child = new ChildProcess()
  Object.defineProperty(child, "pid", { value: pid })
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn(() => true)
  mocks.spawn.mockReturnValue(child)
  return child
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.useRealTimers()
})

for (const platform of ["win32", "darwin"] as const) {
  describe(platform, () => {
    function expectSpawn(stdio: string[]) {
      const options = mocks.spawn.mock.calls[0]?.[2]
      expect(options.stdio).toEqual(stdio)
      expect(options.detached).toBe(platform === "darwin" ? true : undefined)
      expect(options.windowsHide).toBe(platform === "win32" ? true : undefined)
    }

    function expectKill(kill: MockInstance<typeof process.kill>, signal: string) {
      if (platform === "win32") {
        expect(mocks.execFile).toHaveBeenCalledWith(
          "taskkill",
          ["/pid", String(pid), "/T", "/F"],
          { windowsHide: true },
          expect.any(Function),
        )
        expect(kill).not.toHaveBeenCalled()
      } else {
        expect(kill).toHaveBeenCalledWith(-pid, signal)
        expect(mocks.execFile).not.toHaveBeenCalled()
      }
    }

    const spec = { pluginId: "test.mod", root: "/unused", mod: { command: ["bun", "mod.ts"] } }
    it.each([
      ["stop", (host: ModHost) => host.stop()],
      ["disable", (host: ModHost) => host.sync([])],
      ["replace", (host: ModHost) => host.sync([{ ...spec, mod: { command: ["bun", "replacement.ts"] } }])],
    ] as const)("keeps mod pipes attached and reaps the tree on %s", (_action, act) => {
      childProcess()
      const kill = vi.spyOn(process, "kill").mockReturnValue(true)
      const host = new ModHost({ platform, homeDir: "/unused", socketPath: "unused", binPath: "rove", publish() {} })
      host.sync([spec])
      expectSpawn(["pipe", "pipe", "pipe"])
      act(host)
      expectKill(kill, "SIGTERM")
      host.stop()
    })

    it.each([
      ["deadline", () => vi.advanceTimersByTime(100)],
      ["shutdown", (inFlight: Set<() => void>) => [...inFlight].map((stop) => stop())],
    ] as const)("keeps hook pipes attached and reaps the tree on %s", async (_action, act) => {
      vi.useFakeTimers()
      const child = childProcess()
      const kill = vi.spyOn(process, "kill").mockReturnValue(true)
      const inFlight = new Set<() => void>()
      const run = runPluginHook({
        platform,
        homeDir: "/unused",
        socketPath: "unused",
        binPath: "rove",
        pluginId: "test.hook",
        pluginRoot: "/unused",
        spec: { command: ["bun", "hook.ts"], timeoutMs: 100 },
        kind: "startup",
        label: "startup",
        extraEnv: {},
        inFlight,
      })
      expectSpawn(["ignore", "pipe", "pipe"])
      act(inFlight)
      expectKill(kill, "SIGKILL")
      child.emit("close", 0)
      await run
      expect(inFlight.size).toBe(0)
    })
  })
}
