/**
 * `parseStatusJson` — the one place a remote `rove daemon status --json` is
 * read. Everything else in `discover.ts` is an ssh subprocess.
 */

import { describe, expect, it } from "vitest"
import { parseStatusJson } from "../../src/machines/discover.ts"

const FULL = JSON.stringify({
  daemonPid: 900,
  kobeVersion: "0.9.185",
  homeDir: "/Users/nahuelchen",
  socketPath: "/Users/nahuelchen/.rove/daemon.sock",
  ptySocketPath: "/Users/nahuelchen/.rove/pty.sock",
  hostname: "Nahuels-Mac-mini.local",
})

describe("parseStatusJson", () => {
  it("reads both socket paths and the identity triple", () => {
    expect(parseStatusJson(FULL)).toEqual({
      socketPath: "/Users/nahuelchen/.rove/daemon.sock",
      ptySocketPath: "/Users/nahuelchen/.rove/pty.sock",
      homeDir: "/Users/nahuelchen",
      hostname: "Nahuels-Mac-mini.local",
      kobeVersion: "0.9.185",
      daemonPid: 900,
    })
  })

  it("skips a login banner printed before the JSON", () => {
    // A non-interactive login that prints anything at all is common enough
    // that being strict here would read as "Rove is broken on that host".
    expect(parseStatusJson(`Welcome to narwhal\n${FULL}`)?.hostname).toBe("Nahuels-Mac-mini.local")
  })

  it("refuses a status without a pty socket — that machine needs upgrading", () => {
    const old = JSON.stringify({ socketPath: "/s.sock", homeDir: "/h", daemonPid: 1 })
    expect(parseStatusJson(old)).toBeNull()
  })

  it("returns null for no daemon, for prose, and for malformed JSON", () => {
    expect(parseStatusJson("rove daemon: no daemon running at /x/daemon.sock")).toBeNull()
    expect(parseStatusJson("")).toBeNull()
    expect(parseStatusJson("{not json")).toBeNull()
  })
})
