/**
 * The two pure halves of the self-refresh: what a refresh decides to do, and
 * what argv brings this process back.
 *
 * Nothing here spawns anything. The third half genuinely replaces the process,
 * which is why the decision and the argv are separate functions in the first
 * place — they are the only parts a test can hold still.
 */

import { describe, expect, it } from "vitest"
import { type SelfRefreshInputs, planSelfRefresh, selfRelaunchArgv } from "../../src/cli/self-relaunch.ts"

const base: SelfRefreshInputs = {
  daemonVersion: "0.9.159",
  clientVersion: "0.9.159",
  staleInstall: null,
  daemonRestarting: false,
}

describe("planSelfRefresh", () => {
  it("offers nothing when both halves already run the same build", () => {
    // The cost of a refresh is the visible UI going away and coming back.
    // Charging that for no version change is the one outcome worse than the
    // banner the feature replaces.
    expect(planSelfRefresh(base)).toEqual({ kind: "current" })
  })

  it("stays quiet while the daemon's build is still unknown", () => {
    // A daemon that predates the `kobeVersion` field, or a handshake that has
    // not landed yet. Neither is evidence of skew, and guessing produces a
    // refresh prompt on a Rove that is perfectly current.
    expect(planSelfRefresh({ ...base, daemonVersion: null })).toEqual({ kind: "current" })
  })

  it("restarts both halves on a version difference, in either direction", () => {
    // Deliberately not asked: which side is behind. `isDaemonVersionStale` is
    // a string inequality on purpose, and both halves re-read from disk, so
    // both converge on the installed build whichever one was stale.
    expect(planSelfRefresh({ ...base, daemonVersion: "0.9.160" })).toEqual({ kind: "refresh", restartDaemon: true })
    expect(planSelfRefresh({ ...base, daemonVersion: "0.9.100" })).toEqual({ kind: "refresh", restartDaemon: true })
  })

  it("relaunches only itself while a daemon is already being replaced", () => {
    // `rove daemon restart` from another shell is mid-flight. Stopping the
    // daemon again would race that command's own respawn onto the same socket
    // — for a daemon it is already restarting.
    expect(planSelfRefresh({ ...base, daemonRestarting: true })).toEqual({ kind: "refresh", restartDaemon: false })
  })

  it("a restart in flight outranks the skew it is about to cause", () => {
    // Both true at once is the ordinary case: the outgoing daemon reports its
    // OWN (now-stale) version on the way out. Still one restart, not two.
    expect(planSelfRefresh({ ...base, daemonVersion: "0.9.100", daemonRestarting: true })).toEqual({
      kind: "refresh",
      restartDaemon: false,
    })
  })

  it("refuses outright when this install is gone", () => {
    // Relaunching execs a file that no longer exists. The stale-install banner
    // already names the only thing that works, and it outranks skew for the
    // same reason here: restarting a daemon this process cannot spawn is not a
    // fix, and neither is relaunching into nothing.
    expect(
      planSelfRefresh({ ...base, daemonVersion: "0.9.160", staleInstall: "install is gone", daemonRestarting: true }),
    ).toEqual({ kind: "unavailable", reason: "install-gone" })
  })
})

describe("selfRelaunchArgv", () => {
  it("reproduces the invocation, runtime flags included", () => {
    // execArgv is the half that is easy to drop and expensive to miss: Bun
    // keeps its own flags out of argv entirely, so a dev run rebuilt without
    // them relaunches into an opentui resolving the wrong export condition.
    expect(
      selfRelaunchArgv({
        execPath: "/home/u/.bun/bin/bun",
        execArgv: ["--conditions=browser"],
        argv: ["/home/u/.bun/bin/bun", "/repo/src/cli/rove.ts", "--zen"],
      }),
    ).toEqual(["/home/u/.bun/bin/bun", "--conditions=browser", "/repo/src/cli/rove.ts", "--zen"])
  })

  it("carries the user's own arguments across the relaunch", () => {
    // A relaunch that silently drops arguments is not the same Rove coming
    // back — it is a different one, started for the user without being asked.
    expect(
      selfRelaunchArgv({
        execPath: "/usr/local/bin/bun",
        execArgv: [],
        argv: ["/usr/local/bin/bun", "/opt/rove/dist/cli/rove.js", "tasks", "--repo", "/w/x"],
      }),
    ).toEqual(["/usr/local/bin/bun", "/opt/rove/dist/cli/rove.js", "tasks", "--repo", "/w/x"])
  })
})
