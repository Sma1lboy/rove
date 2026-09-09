/**
 * The tunnel's argv. This is the whole transport: if a flag here is wrong, a
 * machine either never connects or — worse — looks connected while forwarding
 * nothing.
 */

import { describe, expect, it } from "vitest"
import type { MachineConfig } from "../../src/machines/registry.ts"
import { localDaemonSocketPath, localPtySocketPath, machineSshArgs, tunnelArgs } from "../../src/machines/ssh-args.ts"

const HOME = "/tmp/rove-home"
const config: MachineConfig = { host: "narwhal", auth: { kind: "key" } }

describe("machineSshArgs", () => {
  it("multiplexes one connection per machine and fails fast", () => {
    const argv = machineSshArgs("narwhal", config, { home: HOME })
    expect(argv[0]).toBe("ssh")
    expect(argv).toContain("BatchMode=yes")
    expect(argv).toContain("ControlMaster=auto")
    expect(argv).toContain(`ControlPath=${HOME}/.rove/machines/narwhal/cm`)
    expect(argv).toContain("StrictHostKeyChecking=accept-new")
    expect(argv.at(-1)).toBe("narwhal")
  })

  it("passes an explicit port and identity file through", () => {
    const argv = machineSshArgs("m", { ...config, port: 2222, auth: { kind: "key", keyPath: "/k" } }, { home: HOME })
    expect(argv).toContain("-p")
    expect(argv[argv.indexOf("-p") + 1]).toBe("2222")
    expect(argv[argv.indexOf("-i") + 1]).toBe("/k")
  })
})

describe("tunnelArgs", () => {
  const argv = tunnelArgs({
    alias: "narwhal",
    config,
    remoteDaemonSocket: "/Users/n/.rove/daemon.sock",
    remotePtySocket: "/Users/n/.rove/pty.sock",
    home: HOME,
  })

  it("forwards both sockets, unix end to unix end", () => {
    expect(argv).toContain(`${localDaemonSocketPath("narwhal", HOME)}:/Users/n/.rove/daemon.sock`)
    expect(argv).toContain(`${localPtySocketPath("narwhal", HOME)}:/Users/n/.rove/pty.sock`)
  })

  it("exits on a forward that cannot bind", () => {
    // Without this, ssh stays up looking healthy while the socket it was
    // supposed to create does not exist — the machine reads as online forever.
    expect(argv).toContain("ExitOnForwardFailure=yes")
    expect(argv).toContain("-N")
  })

  it("keeps the target last, after every flag", () => {
    expect(argv.at(-1)).toBe("narwhal")
  })
})
