import { describe, expect, test } from "vitest"
import {
  launchdDaemonPlist,
  launchdPlist,
  systemdDaemonUnit,
  windowsRunCommand,
} from "../../src/cli/daemon-autostart.ts"
import { WEB_SERVICE } from "../../src/cli/web-service.ts"

const ctx = {
  cli: ["/home/me/.bun/bin/bun", "/opt/my rove/rove-run.js"],
  env: { PATH: "/home/me/.bun/bin:/usr/bin" },
  logPath: "/home/me/.rove/daemon.log",
}

describe("daemon autostart", () => {
  test("the systemd unit runs a resident daemon with the installing shell's PATH and comes back after a crash", () => {
    const unit = systemdDaemonUnit(ctx)
    expect(unit).toContain("ExecStart=/home/me/.bun/bin/bun '/opt/my rove/rove-run.js' daemon start --resident")
    expect(unit).toContain("Environment=PATH=/home/me/.bun/bin:/usr/bin")
    expect(unit).toContain("Restart=on-failure")
    expect(unit).toContain("WantedBy=default.target")
  })

  test("the launchd agent starts once at login and is not kept alive, so a daemon restart is not fought", () => {
    const plist = launchdDaemonPlist({ ...ctx, env: { PATH: "/a&b" } })
    expect(plist).toContain("<string>--resident</string>")
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>")
    expect(plist).toContain("<string>/a&amp;b</string>")
    expect(plist).not.toContain("KeepAlive")
  })

  test("the web bridge's launchd agent runs rove --web and comes back when it dies, the way a phone keeps reaching it", () => {
    const plist = launchdPlist(ctx, WEB_SERVICE)
    expect(plist).toContain("<string>run.rove.web</string>")
    expect(plist).toContain("<string>--web</string>")
    expect(plist).toContain("<key>KeepAlive</key>")
  })

  test("the Windows Run entry starts the daemon through the windowless launcher, quoting a path with spaces", () => {
    expect(windowsRunCommand({ ...ctx, cli: ["C:\\bun.exe", "C:\\Program Files\\rove\\rove-run.js"] })).toBe(
      'conhost.exe --headless C:\\bun.exe "C:\\Program Files\\rove\\rove-run.js" daemon autostart run',
    )
  })
})
