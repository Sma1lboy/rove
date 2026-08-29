import { describe, expect, it } from "vitest"
import { SANDBOX_DAEMON_WEB_PORT, parseSandboxArgs, sandboxPortForName } from "../../scripts/dev-sandbox-args"
import { sandboxChildEnv } from "../../scripts/dev-sandbox-env"

describe("parseSandboxArgs", () => {
  it("defaults to the run mode with no rove argv", () => {
    expect(parseSandboxArgs(["run"])).toEqual({ mode: "run", roveArgs: [] })
    expect(parseSandboxArgs([])).toEqual({ mode: "run", roveArgs: [] })
  })

  it("keeps reset and home unchanged", () => {
    expect(parseSandboxArgs(["reset"])).toEqual({ mode: "reset", roveArgs: [] })
    expect(parseSandboxArgs(["home"])).toEqual({ mode: "home", roveArgs: [] })
  })

  it("run forwards trailing rove argv; other modes still reject extras", () => {
    expect(parseSandboxArgs(["run", "api", "list"])).toEqual({ mode: "run", roveArgs: ["api", "list"] })
    expect(() => parseSandboxArgs(["reset", "extra"])).toThrow('unexpected argument "extra"')
  })

  it("rejects retired launch flags", () => {
    expect(() => parseSandboxArgs(["--tmux"])).toThrow('unknown sandbox mode "--tmux"')
  })

  it("--name selects a named instance and validates the name", () => {
    expect(parseSandboxArgs(["--name", "ex-a", "smoketest"])).toEqual({
      mode: "smoketest",
      name: "ex-a",
      roveArgs: [],
    })
    expect(() => parseSandboxArgs(["--name", "Bad Name"])).toThrow(/instance name/)
    expect(() => parseSandboxArgs(["--name"])).toThrow(/instance name/)
  })
})

describe("sandboxPortForName", () => {
  it("is deterministic, in-range, and distinct across names", () => {
    const a = Number(sandboxPortForName("ex-a"))
    expect(a).toBe(Number(sandboxPortForName("ex-a")))
    expect(a).toBeGreaterThanOrEqual(5300)
    expect(a).toBeLessThan(6000)
    expect(sandboxPortForName("ex-a")).not.toBe(sandboxPortForName("ex-b"))
  })
})

describe("sandboxChildEnv", () => {
  it("overrides ambient home aliases in both namespaces", () => {
    const env = sandboxChildEnv("/tmp/isolated", {
      ROVE_HOME_DIR: "/real-rove-home",
      KOBE_HOME_DIR: "/real-kobe-home",
    })

    expect(env.ROVE_HOME_DIR).toBe("/tmp/isolated")
    expect(env.KOBE_HOME_DIR).toBe("/tmp/isolated")
    expect(env.ROVE_DEV).toBe("1")
    expect(env.KOBE_DEV).toBe("1")
  })

  // The prod 2026-08-13 socket hijack: a TUI stamps the production socket onto
  // every task terminal it spawns, and an explicit socket path outranks
  // HOME_DIR — so an inherited one made the sandbox daemon bind the REAL
  // socket and serve its empty task index to attached TUIs. Pinning the paths
  // under the sandbox home fixes it; deleting them only deferred to HOME_DIR,
  // which a stray override could still poison.
  it("pins socket and pid paths under the sandbox home so inherited overrides cannot outrank it", () => {
    const env = sandboxChildEnv("/tmp/isolated", {
      KOBE_DAEMON_SOCKET_PATH: "/run/user/1000/kobe.sock",
      ROVE_DAEMON_SOCKET_PATH: "/run/user/1000/kobe.sock",
      KOBE_PTY_SOCKET_PATH: "/run/user/1000/kobe-pty.sock",
      ROVE_PTY_SOCKET_PATH: "/run/user/1000/kobe-pty.sock",
      KOBE_DAEMON_PID_PATH: "/home/dev/.kobe/daemon.pid",
      ROVE_DAEMON_PID_PATH: "/home/dev/.kobe/daemon.pid",
      KOBE_PTY_PID_PATH: "/home/dev/.kobe/pty.pid",
      ROVE_PTY_PID_PATH: "/home/dev/.kobe/pty.pid",
    })

    expect(env.ROVE_DAEMON_SOCKET_PATH).toBe("/tmp/isolated/.rove/daemon.sock")
    expect(env.KOBE_DAEMON_SOCKET_PATH).toBe("/tmp/isolated/.rove/daemon.sock")
    expect(env.ROVE_PTY_SOCKET_PATH).toBe("/tmp/isolated/.rove/pty.sock")
    expect(env.KOBE_PTY_SOCKET_PATH).toBe("/tmp/isolated/.rove/pty.sock")
    expect(env.ROVE_DAEMON_PID_PATH).toBe("/tmp/isolated/.rove/daemon.pid")
    expect(env.KOBE_DAEMON_PID_PATH).toBe("/tmp/isolated/.rove/daemon.pid")
    expect(env.ROVE_PTY_PID_PATH).toBe("/tmp/isolated/.rove/pty.pid")
    expect(env.KOBE_PTY_PID_PATH).toBe("/tmp/isolated/.rove/pty.pid")
    expect(env.KOBE_HOME_DIR).toBe("/tmp/isolated")
  })

  it("ignores an ambient production web port and uses the sandbox default", () => {
    const env = sandboxChildEnv("/tmp/isolated", {
      ROVE_DAEMON_WEB_PORT: "45174",
      KOBE_DAEMON_WEB_PORT: "45174",
    })

    expect(env.ROVE_DAEMON_WEB_PORT).toBe(SANDBOX_DAEMON_WEB_PORT)
    expect(env.KOBE_DAEMON_WEB_PORT).toBe(SANDBOX_DAEMON_WEB_PORT)
  })

  it("a named instance derives its own stable port", () => {
    const env = sandboxChildEnv("/tmp/isolated", {}, "ex-a")
    expect(env.ROVE_DAEMON_WEB_PORT).toBe(sandboxPortForName("ex-a"))
    expect(env.ROVE_DAEMON_WEB_PORT).not.toBe(SANDBOX_DAEMON_WEB_PORT)
  })

  it("still honours an explicitly sandbox-scoped web port", () => {
    const env = sandboxChildEnv("/tmp/isolated", {
      ROVE_SANDBOX_DAEMON_WEB_PORT: "6123",
      KOBE_DAEMON_WEB_PORT: "45174",
    })

    expect(env.ROVE_DAEMON_WEB_PORT).toBe("6123")
    expect(env.KOBE_DAEMON_WEB_PORT).toBe("6123")
  })
})
