import { afterEach, describe, expect, it, vi } from "vitest"
import { processAlive, watchParent } from "../pty-parent-watch.mjs"

function errno(code: string): Error {
  return Object.assign(new Error(code), { code })
}

describe("processAlive", () => {
  it("treats EPERM as alive and ESRCH as gone", () => {
    expect(processAlive(1, () => true)).toBe(true)
    expect(
      processAlive(1, () => {
        throw errno("EPERM")
      }),
    ).toBe(true)
    expect(
      processAlive(1, () => {
        throw errno("ESRCH")
      }),
    ).toBe(false)
  })
})

describe("watchParent", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("fires once when the POSIX parent is gone and the orphan is re-parented", () => {
    vi.useFakeTimers()
    let ppid = 42
    const onGone = vi.fn()
    watchParent({ onGone, parentPid: 42, currentPpid: () => ppid, isAlive: () => true, intervalMs: 100 })

    vi.advanceTimersByTime(300)
    expect(onGone).not.toHaveBeenCalled()
    ppid = 1
    vi.advanceTimersByTime(300)
    expect(onGone).toHaveBeenCalledTimes(1)
  })

  it("fires when the parent pid stops existing though the ppid is unchanged", () => {
    vi.useFakeTimers()
    let alive = true
    const onGone = vi.fn()
    watchParent({ onGone, parentPid: 42, currentPpid: () => 42, isAlive: () => alive, intervalMs: 100 })

    alive = false
    vi.advanceTimersByTime(100)
    expect(onGone).toHaveBeenCalledTimes(1)
  })
})
