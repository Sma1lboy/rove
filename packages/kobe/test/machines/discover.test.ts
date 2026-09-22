/**
 * `parseStatusJson` — the one place a remote `rove daemon status --json` is
 * read. Everything else in `discover.ts` is an ssh subprocess.
 */

import { describe, expect, it } from "vitest"
import { looksLikeOldStatus, parseStatusJson } from "../../src/machines/discover.ts"

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

  it("skips an rc-file echo printed after the JSON", () => {
    // A non-interactive shell prints on the way out as readily as on the way
    // in ("you have mail", an rc-file echo). A trailing line must not make a
    // healthy daemon read as "could not read a daemon status".
    expect(parseStatusJson(`${FULL}\nyou have mail`)?.hostname).toBe("Nahuels-Mac-mini.local")
  })

  it("extracts the object with noise on both sides", () => {
    expect(parseStatusJson(`Welcome\n${FULL}\nlogout`)?.socketPath).toBe("/Users/nahuelchen/.rove/daemon.sock")
  })

  it("is unfazed by a brace inside a socket path", () => {
    const braced = JSON.stringify({ ...JSON.parse(FULL), socketPath: "/tmp/rove-{1}/daemon.sock" })
    expect(parseStatusJson(`${braced}\ntrailing`)?.socketPath).toBe("/tmp/rove-{1}/daemon.sock")
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

describe("looksLikeOldStatus", () => {
  it("recognizes a machine whose Rove predates the pty socket field", () => {
    // This is the difference between "that machine needs upgrading" and "its
    // daemon would not start" — two remedies, and only one of them works.
    expect(looksLikeOldStatus(JSON.stringify({ socketPath: "/s.sock", homeDir: "/h" }))).toBe(true)
    expect(looksLikeOldStatus(FULL)).toBe(false)
    expect(looksLikeOldStatus("rove daemon: no daemon running")).toBe(false)
  })

  it("still recognizes an old status wrapped in shell noise", () => {
    const old = JSON.stringify({ socketPath: "/s.sock", homeDir: "/h" })
    expect(looksLikeOldStatus(`motd\n${old}\nlogout`)).toBe(true)
  })
})
