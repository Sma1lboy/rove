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
  type MachineEntry,
  dedupeMachines,
  defaultMachineAlias,
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

describe("dedupeMachines", () => {
  const identity = { hostname: "mac-mini", homeDir: "/Users/n", daemonPid: 42 }
  const entry = (alias: string, over: Partial<MachineEntry> = {}): MachineEntry => ({
    alias,
    host: alias,
    auth: { kind: "key" },
    ...over,
  })

  it("keeps the first alias when two name one machine", () => {
    // The sidebar and `rove api list` share this rule: the two disagreeing is
    // exactly the bug — one row on screen, every remote task listed twice.
    const kept = dedupeMachines([
      entry("narwhal", { identity }),
      entry("nar2", { identity }),
      entry("vps", { identity: { ...identity, hostname: "vps" } }),
    ])
    expect(kept.map((m) => m.alias)).toEqual(["narwhal", "vps"])
  })

  it("keeps an entry that has never connected — it may be its own machine", () => {
    const kept = dedupeMachines([entry("narwhal", { identity }), entry("fresh")])
    expect(kept.map((m) => m.alias)).toEqual(["narwhal", "fresh"])
  })
})

describe("defaultMachineAlias", () => {
  it("keeps a bare host — the user already named that machine", () => {
    // `rove machine add narwhal` should give you a machine called `narwhal`.
    // They picked that short name in ssh_config; the hostname is one they
    // never chose, and `Nahuels-Mac-mini.local` fills the sidebar rail.
    expect(defaultMachineAlias({ typedHost: "narwhal", remoteHostname: "Nahuels-Mac-mini.local" })).toBe("narwhal")
  })

  it("prefers the remote hostname when the target is addressing, not a name", () => {
    const remoteHostname = "Nahuels-Mac-mini.local"
    expect(defaultMachineAlias({ typedHost: "mac.local", typedUser: "nahuel", remoteHostname })).toBe(
      "Nahuels-Mac-mini",
    )
    expect(defaultMachineAlias({ typedHost: "mac.local", port: 2222, remoteHostname })).toBe("Nahuels-Mac-mini")
    expect(defaultMachineAlias({ typedHost: "192.168.1.5", remoteHostname })).toBe("Nahuels-Mac-mini")
    expect(defaultMachineAlias({ typedHost: "fe80::1", remoteHostname })).toBe("Nahuels-Mac-mini")
  })

  it("falls back to the typed host when the machine reported no hostname", () => {
    // An IP with nothing to fall back to would otherwise become `192`.
    expect(defaultMachineAlias({ typedHost: "build-box", typedUser: "ci" })).toBe("build-box")
  })

  it("always yields something usable as a path segment", () => {
    expect(defaultMachineAlias({ typedHost: "weird host/name" })).toBe("weird-host-name")
  })
})
