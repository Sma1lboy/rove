/**
 * Switching a task's engine must SAY what happened, on both routes.
 *
 * The ctrl+e picker adds its tab to local state first, so the new tab renders
 * under the new engine's label whether or not the `setVendor` write lands. A
 * rejected write therefore looked exactly like a success — while the task kept
 * its old vendor, so every later tab and the next reopen quietly reverted.
 *
 * The row chord (`v`) already toasted both outcomes; `applyVendorChange` is the
 * shared half so the two routes can't drift again.
 */

import { describe, expect, test, vi } from "vitest"
import { applyVendorChange } from "../../src/tui/lib/task-actions"

function ctx(setVendor: () => Promise<void>) {
  return {
    orch: { setVendor: vi.fn(setVendor) } as never,
    logger: { error: vi.fn() },
    logPrefix: "[test]",
    notifyError: vi.fn(),
    notifyInfo: vi.fn(),
  }
}

describe("applyVendorChange", () => {
  test("a successful switch reports that it applies on reopen", async () => {
    const c = ctx(async () => {})
    await expect(applyVendorChange(c, "t1", "codex")).resolves.toBe(true)
    expect(c.notifyError).not.toHaveBeenCalled()
    // The rebuild is deferred to the task's next enter, so silence here would
    // read as "nothing happened".
    const said = c.notifyInfo.mock.calls[0]?.[0] as string
    expect(said).toContain("applies on reopen")
  })

  test("a rejected switch reports the failure and the reason", async () => {
    const c = ctx(async () => {
      throw new Error("daemon refused")
    })
    await expect(applyVendorChange(c, "t1", "codex")).resolves.toBe(false)
    // The log line stays for forensics...
    expect(c.logger.error).toHaveBeenCalled()
    // ...but the user-visible half is the point: it must name the failure
    // and carry the underlying reason.
    const said = c.notifyError.mock.calls[0]?.[0] as string
    expect(said).toContain("Couldn't switch engine")
    expect(said).toContain("daemon refused")
    // A failure must NOT also claim success.
    expect(c.notifyInfo).not.toHaveBeenCalled()
  })
})
