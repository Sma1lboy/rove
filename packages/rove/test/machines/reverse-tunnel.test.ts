import { describe, expect, test } from "vitest"
import type { MachineConfig } from "../../src/machines/registry.ts"
import { launchdPlist, reverseTunnelArgv, systemdUnit } from "../../src/machines/reverse-tunnel.ts"

const mac = { host: "192.168.1.107", user: "me", auth: { kind: "key", keyPath: "/home/me/.ssh/hub" } } as MachineConfig
const ports = { remotePort: 2222, localPort: 22 }

describe("reverse tunnel", () => {
  test("the ssh command forwards the other machine's loopback port back here and fails fast", () => {
    const argv = reverseTunnelArgv(mac, ports)
    expect(argv.slice(0, 2)).toEqual(["ssh", "-N"])
    // A supervisor restarts on exit, so a forward that cannot bind must exit, and a dead link must be noticed.
    expect(argv).toContain("ExitOnForwardFailure=yes")
    expect(argv).toContain("ServerAliveInterval=15")
    expect(argv).toContain("BatchMode=yes")
    expect(argv.slice(-4)).toEqual(["/home/me/.ssh/hub", "-R", "127.0.0.1:2222:127.0.0.1:22", "me@192.168.1.107"])
  })

  test("the systemd unit restarts forever and starts at login", () => {
    const unit = systemdUnit("mac", ["/usr/bin/ssh", "-N", "-R", "127.0.0.1:2222:127.0.0.1:22", "me@host"])
    expect(unit).toContain("ExecStart=/usr/bin/ssh -N -R 127.0.0.1:2222:127.0.0.1:22 me@host")
    expect(unit).toContain("Restart=always")
    expect(unit).toContain("WantedBy=default.target")
  })

  test("the launchd agent keeps it alive and escapes its arguments", () => {
    const plist = launchdPlist("mac", ["/usr/bin/ssh", "-o", "Opt=<x&y>"])
    expect(plist).toContain("<string>run.rove.tunnel.mac</string>")
    expect(plist).toContain("<key>KeepAlive</key>\n  <true/>")
    expect(plist).toContain("<string>Opt=&lt;x&amp;y&gt;</string>")
  })
})
