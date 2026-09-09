/**
 * The pure halves of the machine registry: how an ssh target is read, what a
 * usable alias is, and the rule that decides two aliases name one machine.
 *
 * No state file is touched — every function here takes its input explicitly,
 * which is why the identity rule can be tested at all.
 */

import { describe, expect, it } from "vitest"
import {
  type MachineConfig,
  duplicateAliasOf,
  isValidMachineAlias,
  parseSshTarget,
  sshTargetOf,
} from "../../src/machines/registry.ts"

describe("parseSshTarget", () => {
  it("reads a bare host as a host with no user or port", () => {
    expect(parseSshTarget("narwhal")).toEqual({ host: "narwhal" })
  })

  it("reads user@host:port", () => {
    expect(parseSshTarget("nahuel@mac-mini.local:2222")).toEqual({
      host: "mac-mini.local",
      user: "nahuel",
      port: 2222,
    })
  })

  it("keeps an unbracketed IPv6 literal whole, and reads a bracketed port", () => {
    // `::1` split on the last colon would be host `:` on port 1 — a silently
    // WRONG target. ssh's own rule: brackets are how an IPv6 address carries
    // a port.
    expect(parseSshTarget("::1")).toEqual({ host: "::1" })
    expect(parseSshTarget("fe80::1:2222")).toEqual({ host: "fe80::1:2222" })
    expect(parseSshTarget("[fe80::1]:2222")).toEqual({ host: "fe80::1", port: 2222 })
  })

  it("refuses empty, whitespace-bearing and out-of-range input", () => {
    expect(parseSshTarget("")).toBeNull()
    expect(parseSshTarget("   ")).toBeNull()
    expect(parseSshTarget("@host")).toBeNull()
    expect(parseSshTarget("a b")).toBeNull()
    expect(parseSshTarget("host:70000")).toBeNull()
  })
})

describe("isValidMachineAlias", () => {
  it("accepts a path-safe name and rejects the reserved local id", () => {
    expect(isValidMachineAlias("narwhal")).toBe(true)
    expect(isValidMachineAlias("Nahuels-Mac-mini.local")).toBe(true)
    expect(isValidMachineAlias("local")).toBe(false)
  })

  it("rejects anything that would escape its own socket directory", () => {
    expect(isValidMachineAlias("../etc")).toBe(false)
    expect(isValidMachineAlias("a/b")).toBe(false)
    expect(isValidMachineAlias("")).toBe(false)
  })
})

describe("sshTargetOf", () => {
  it("omits the user so ssh_config can supply it", () => {
    const bare: MachineConfig = { host: "narwhal", auth: { kind: "key" } }
    expect(sshTargetOf(bare)).toBe("narwhal")
    expect(sshTargetOf({ ...bare, user: "nahuel" })).toBe("nahuel@narwhal")
  })
})

describe("duplicateAliasOf", () => {
  const identity = { hostname: "mac-mini", homeDir: "/Users/n", daemonPid: 42 }
  const machines: Record<string, MachineConfig> = {
    narwhal: { host: "narwhal", auth: { kind: "key" }, identity },
    other: { host: "vps", auth: { kind: "key" }, identity: { ...identity, hostname: "vps" } },
  }

  it("finds the alias already naming this machine", () => {
    expect(duplicateAliasOf(machines, "nar2", identity)).toBe("narwhal")
  })

  it("never reports an alias as its own duplicate", () => {
    expect(duplicateAliasOf(machines, "narwhal", identity)).toBeNull()
  })

  it("needs all three parts to agree — a shared hostname is not a machine", () => {
    // Two VMs cloned from one image share a hostname; two macs share a homeDir
    // shape; a pid recycles. Only the triple names one running daemon.
    expect(duplicateAliasOf(machines, "nar2", { ...identity, daemonPid: 43 })).toBeNull()
    expect(duplicateAliasOf(machines, "nar2", { ...identity, homeDir: "/Users/other" })).toBeNull()
  })

  it("ignores a machine that has never connected (no identity yet)", () => {
    expect(duplicateAliasOf({ fresh: { host: "h", auth: { kind: "key" } } }, "x", identity)).toBeNull()
  })
})
