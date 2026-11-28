/**
 * Leaving the TUI must not outrun the terminal restore: OpenTUI's `destroy()`
 * only schedules it, and a process that exits (or execs, or blocks on a child)
 * first leaves the alt screen up.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { restoreTerminal } from "../../src/lib/restore-terminal"

/** A renderer whose restore finishes when the test says so. */
function fakeRenderer() {
  let finish: () => void = () => {}
  let fail: (err: Error) => void = () => {}
  const closed = new Promise<void>((resolve, reject) => {
    finish = resolve
    fail = reject
  })
  return { renderer: { destroy: vi.fn(), closed }, finish, fail }
}

describe("restoreTerminal", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test("resolves only once the terminal is restored", async () => {
    const { renderer, finish } = fakeRenderer()
    const done = vi.fn()

    const restoring = restoreTerminal(renderer).then(done)
    await Promise.resolve()
    expect(renderer.destroy).toHaveBeenCalledOnce()
    expect(done).not.toHaveBeenCalled()

    finish()
    await restoring
    expect(done).toHaveBeenCalledOnce()
  })

  test("still resolves when the restore never finishes", async () => {
    const { renderer } = fakeRenderer()
    const restoring = restoreTerminal(renderer)
    await vi.runAllTimersAsync()
    await expect(restoring).resolves.toBeUndefined()
  })

  test("still resolves when the restore fails", async () => {
    const { renderer, fail } = fakeRenderer()
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})

    const restoring = restoreTerminal(renderer)
    fail(new Error("native session lost"))
    await expect(restoring).resolves.toBeUndefined()
    logged.mockRestore()
  })

  test("no renderer is a no-op", async () => {
    await expect(restoreTerminal(null)).resolves.toBeUndefined()
  })
})
