import {
  isDaemonVersionStale,
  isForeignDaemonHome,
  isProtocolCompatible,
  normalizeChannelFilter,
} from "@sma1lboy/kobe-daemon/daemon/protocol"
import { describe, expect, it } from "vitest"

describe("isProtocolCompatible", () => {
  it("accepts two peers on the same version + min", () => {
    expect(isProtocolCompatible({ localVersion: 2, localMin: 2, remoteVersion: 2, remoteMin: 2 })).toBe(true)
  })

  it("lets an older client talk to a newer daemon when the min stayed put (rolling upgrade)", () => {
    // daemon bumped to v3 but still supports v2; client is v2/min2.
    expect(isProtocolCompatible({ localVersion: 2, localMin: 2, remoteVersion: 3, remoteMin: 2 })).toBe(true)
    // symmetric: newer daemon's view of the older client.
    expect(isProtocolCompatible({ localVersion: 3, localMin: 2, remoteVersion: 2, remoteMin: 2 })).toBe(true)
  })

  it("rejects a peer older than our minimum", () => {
    // remote is v1, but we do not speak below v2.
    expect(isProtocolCompatible({ localVersion: 2, localMin: 2, remoteVersion: 1, remoteMin: 1 })).toBe(false)
  })

  it("rejects when we are older than the remote's minimum", () => {
    // remote dropped support below v3; we are still v2.
    expect(isProtocolCompatible({ localVersion: 2, localMin: 2, remoteVersion: 3, remoteMin: 3 })).toBe(false)
  })
})

describe("isForeignDaemonHome", () => {
  it("rejects a sandbox daemon squatting on the production socket", () => {
    // `dev:sandbox` inheriting KOBE_DAEMON_SOCKET_PATH from the task terminal
    // binds the real socket and serves an EMPTY task index.
    expect(isForeignDaemonHome("/repo/packages/kobe/.dev-sandbox/home", "/home/dev")).toBe(true)
  })

  it("ignores trailing separators on either side", () => {
    // XDG_RUNTIME_DIR and friends arrive with and without the trailing slash;
    // a cosmetic difference must never look like a foreign daemon.
    expect(isForeignDaemonHome("/home/dev/", "/home/dev")).toBe(false)
    expect(isForeignDaemonHome("/home/dev", "/home/dev/")).toBe(false)
  })

  it("accepts a daemon that reports no home (predates the field)", () => {
    // Same rolling-upgrade rule as kobeVersion: an old daemon is never
    // rejected on evidence it cannot supply.
    expect(isForeignDaemonHome(undefined, "/home/dev")).toBe(false)
  })
})

describe("isDaemonVersionStale", () => {
  it("is stale when the daemon is OLDER than the client (the common upgrade case)", () => {
    // User ran `npm i -g @sma1lboy/kobe@latest` (client v0.7.4) but the
    // long-lived daemon is still running v0.7.3 in memory.
    expect(isDaemonVersionStale("0.7.3", "0.7.4")).toBe(true)
  })

  it("is NOT stale when the daemon version is unknown (older daemon omits the field)", () => {
    // A daemon predating the kobeVersion handshake field reports undefined;
    // we must never flag that as stale (no false banner).
    expect(isDaemonVersionStale(undefined, "0.7.4")).toBe(false)
  })
})

describe("normalizeChannelFilter", () => {
  it("returns null (deliver-everything) for an omitted / non-array request", () => {
    // Back-compat: a subscriber that never sent `channels` gets every channel.
    expect(normalizeChannelFilter(undefined)).toBeNull()
    expect(normalizeChannelFilter("ui-prefs")).toBeNull()
    expect(normalizeChannelFilter({})).toBeNull()
  })

  it("drops unknown names (forward-compat) but keeps the valid ones", () => {
    const set = normalizeChannelFilter(["ui-prefs", "future-channel", 7])
    expect([...(set ?? [])]).toEqual(["ui-prefs"])
  })

  it("returns null when the filter has zero valid channels (deliver-everything)", () => {
    // An all-garbage / empty list must not silently mute the subscriber —
    // it falls back to the deliver-all default.
    expect(normalizeChannelFilter([])).toBeNull()
    expect(normalizeChannelFilter(["bogus", 1])).toBeNull()
  })
})
