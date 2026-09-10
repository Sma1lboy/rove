/**
 * The tunnel's argv. This is the whole transport: if a flag here is wrong, a
 * machine either never connects or — worse — looks connected while forwarding
 * nothing.
 */

import { describe, expect, it } from "vitest"
import type { MachineConfig } from "../../src/machines/registry.ts"
import { machineSocketDir, machineSshArgs } from "../../src/machines/ssh-args.ts"

const HOME = "/tmp/rove-home"
const config: MachineConfig = { host: "narwhal", auth: { kind: "key" } }

/**
 * POSIX-only. Every assertion below is about unix-socket forwarding, which
 * OpenSSH on Windows does not have — `startTunnel` reports `unsupported`
 * there rather than pretending, and the path arithmetic uses `/`.
 */
const POSIX = process.platform !== "win32"

describe.skipIf(!POSIX)("machineSshArgs", () => {
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

describe.skipIf(!POSIX)("machineSocketDir", () => {
  it("keeps the natural path when it fits", () => {
    expect(machineSocketDir("narwhal", "/Users/x")).toBe("/Users/x/.rove/machines/narwhal")
  })

  it("falls back to a short path when a socket inside it would not fit", () => {
    // A Rove home inside a worktree already spends most of the ~104-byte
    // sun_path budget; ssh's own refusal is `ControlPath too long`, which
    // names neither the machine nor the remedy.
    const deep = "/Users/someone/.rove/worktrees/kobe-0aff3858ab76/ocelot/.scratch/opentui-visual-5473/home"
    const dir = machineSocketDir("narwhal", deep)
    expect(dir).not.toContain(deep)
    expect(Buffer.byteLength(`${dir}/daemon.sock`)).toBeLessThanOrEqual(100)
  })

  it("gives the same fallback every time — a client must find the same socket", () => {
    const deep = "/Users/someone/.rove/worktrees/kobe-0aff3858ab76/ocelot/.scratch/opentui-visual-5473/home"
    expect(machineSocketDir("narwhal", deep)).toBe(machineSocketDir("narwhal", deep))
    expect(machineSocketDir("narwhal", deep)).not.toBe(machineSocketDir("other", deep))
  })
})
