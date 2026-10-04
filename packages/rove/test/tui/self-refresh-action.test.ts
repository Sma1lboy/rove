/**
 * The refresh ACTION — the ordering nobody can observe from the outside once
 * it has run, because the last thing it does is stop being this process.
 *
 * Two properties are worth pinning and neither is about the plan (that has its
 * own test in `test/cli/self-relaunch.test.ts`): consent comes before any
 * teardown, and the daemon is stopped BEFORE the relaunch rather than queued
 * behind it. The relaunch arrives as an injected dependency for exactly that
 * reason — the real one never returns, so a test can only assert what happened
 * up to it.
 */

import { describe, expect, it, vi } from "vitest"
import type { SelfRefreshInputs } from "../../src/cli/self-relaunch.ts"
import { selfRefreshAction } from "../../src/tui-react/workspace/self-refresh-action.ts"

const skewed: SelfRefreshInputs = {
  daemonVersion: "0.9.160",
  clientVersion: "0.9.159",
  staleInstall: null,
  daemonRestarting: false,
}

function deps(overrides: Partial<Parameters<typeof selfRefreshAction>[0]> = {}) {
  const order: string[] = []
  const restartDaemon = vi.fn(async () => {
    order.push("restart-daemon")
  })
  const relaunch = vi.fn(() => {
    order.push("relaunch")
  }) as unknown as (opts: { renderer: { destroy(): void } | null | undefined; notice: string }) => never
  const notifyError = vi.fn()
  return {
    order,
    restartDaemon,
    relaunch,
    notifyError,
    deps: {
      orchestrator: { restartDaemon },
      renderer: { destroy: vi.fn() },
      confirm: vi.fn(async () => true),
      notifyError,
      t: (key: string) => key,
      relaunch,
      ...overrides,
    } as Parameters<typeof selfRefreshAction>[0],
  }
}

describe("selfRefreshAction", () => {
  it("stops the daemon before relaunching, never after", async () => {
    // "After" does not exist: the relaunch replaces this process, so anything
    // sequenced behind it simply never runs — and the user is left with a new
    // client still talking to the stale daemon they asked to be rid of.
    const d = deps()
    await selfRefreshAction(d.deps, skewed)
    expect(d.order).toEqual(["restart-daemon", "relaunch"])
  })

  it("does nothing at all when the confirm is declined", async () => {
    // A declined refresh must leave BOTH halves running. Stopping the daemon
    // and then not relaunching is strictly worse than never having offered.
    const d = deps({ confirm: vi.fn(async () => false) })
    expect(await selfRefreshAction(d.deps, skewed)).toBe(false)
    expect(d.restartDaemon).not.toHaveBeenCalled()
    expect(d.relaunch).not.toHaveBeenCalled()
  })

  it("leaves a daemon someone else is already restarting alone", async () => {
    const d = deps()
    await selfRefreshAction(d.deps, { ...skewed, daemonRestarting: true })
    expect(d.restartDaemon).not.toHaveBeenCalled()
    expect(d.relaunch).toHaveBeenCalledTimes(1)
  })

  it("reports rather than acts when there is nothing to refresh", async () => {
    // Reachable through the settings row, which is always offered — unlike the
    // banner chord, which is only registered while a refresh is available.
    const d = deps()
    expect(await selfRefreshAction(d.deps, { ...skewed, daemonVersion: "0.9.159" })).toBe(false)
    expect(d.notifyError).toHaveBeenCalledWith("update.refresh.alreadyCurrent")
    expect(d.relaunch).not.toHaveBeenCalled()
  })

  it("refuses to relaunch an install that is gone, and says why", async () => {
    // The one failure mode a relaunch turns into a dead terminal: exec'ing a
    // file that no longer exists, with the renderer already torn down.
    const d = deps()
    expect(await selfRefreshAction(d.deps, { ...skewed, staleInstall: "gone" })).toBe(false)
    expect(d.notifyError).toHaveBeenCalledWith("update.refresh.installGone")
    expect(d.restartDaemon).not.toHaveBeenCalled()
    expect(d.relaunch).not.toHaveBeenCalled()
  })

  it("asks before touching anything", async () => {
    const confirm = vi.fn(async () => {
      // Whatever the user is about to decide, nothing may have happened yet.
      expect(d.restartDaemon).not.toHaveBeenCalled()
      expect(d.relaunch).not.toHaveBeenCalled()
      return true
    })
    const d = deps({ confirm })
    await selfRefreshAction(d.deps, skewed)
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
