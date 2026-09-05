import { describe, expect, it } from "vitest"
import { parseSandboxArgs } from "../../scripts/dev-sandbox-args"
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

  // The socket-hijack shape: a TUI stamps the production socket onto every
  // task terminal it spawns, and an explicit socket path outranks HOME_DIR —
  // so an inherited one makes the sandbox daemon bind the REAL socket and
  // serve its empty task index to attached TUIs. Pinning the paths under the
  // sandbox home fixes it; deleting them only defers to HOME_DIR, which a
  // stray override can still poison.
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

  // A redirected HOME hid ~/.claude.json, ~/.codex/auth.json and friends from
  // the engines, so the sandbox offered a different vendor set than production.
  it("keeps the operator's HOME so engines see production credentials", () => {
    const env = sandboxChildEnv("/tmp/isolated", { HOME: "/Users/op" })
    expect(env.HOME).toBe("/Users/op")
    expect(env.XDG_CONFIG_HOME).toBeUndefined()
    expect(env.ROVE_HOME_DIR).toBe("/tmp/isolated")
  })

  // The daemon has no HTTP listener, so the sandbox allocates no port for one.
  // What isolates a sandbox instance is its home and its sockets — both pinned
  // above. A port stamped here would only look like a second isolation
  // mechanism to whoever reads this next.
  it("stamps no web-port knob at all", () => {
    const env = sandboxChildEnv("/tmp/isolated", { HOME: "/Users/op" })
    for (const key of Object.keys(env)) expect(key).not.toMatch(/WEB_PORT$/)
  })
})
