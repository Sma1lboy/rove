/**
 * Quit must not outrun the terminal restore: OpenTUI's `destroy()` only
 * schedules it, and a process that exits first leaves the alt screen up.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { exitAfterRestore } from "../../src/tui-react/workspace/exit-after-restore"

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

describe("exitAfterRestore", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test("exits only once the terminal is restored", async () => {
    const { renderer, finish } = fakeRenderer()
    const exit = vi.fn()

    const quitting = exitAfterRestore(renderer, exit)
    await Promise.resolve()
    expect(exit).not.toHaveBeenCalled()

    finish()
    await quitting
    expect(exit).toHaveBeenCalledOnce()
  })

  test("still exits when the restore never finishes", async () => {
    const { renderer } = fakeRenderer()
    const exit = vi.fn()

    const quitting = exitAfterRestore(renderer, exit)
    await vi.runAllTimersAsync()
    await quitting

    expect(exit).toHaveBeenCalledOnce()
  })

  test("still exits when the restore fails", async () => {
    const { renderer, fail } = fakeRenderer()
    const exit = vi.fn()
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})

    const quitting = exitAfterRestore(renderer, exit)
    fail(new Error("native session lost"))
    await quitting

    expect(exit).toHaveBeenCalledOnce()
    logged.mockRestore()
  })
})
