/**
 * Unit tests for `src/engine/hook-adapter.ts` — the neutral engine-hook seam.
 *
 * Why these matter: `createEngineHookAdapter` is the one place the
 * orchestrator resolves a vendor to its hook installer, and NoopHookAdapter
 * is the contract-completeness backstop for engines without wired hooks
 * (Copilot, custom engines). If the noop half ever starts claiming hook
 * support (or throws), every launch path that probes `supportsHooks()`
 * before installing would start writing into a config file that doesn't
 * exist for that engine.
 */

import { describe, expect, it } from "vitest"
import { NoopHookAdapter, createEngineHookAdapter } from "../../src/engine/hook-adapter.ts"

describe("createEngineHookAdapter", () => {
  it("resolves copilot to its own wired adapter, not the noop one", () => {
    const adapter = createEngineHookAdapter("copilot")
    expect(adapter.supportsHooks()).toBe(true)
    expect(adapter.vendor).toBe("copilot")
  })
})

describe("NoopHookAdapter", () => {
  const noop = new NoopHookAdapter("copilot")

  it("every install/remove is a resolved no-op (never throws into the launch path)", async () => {
    await expect(noop.installActivityHooks()).resolves.toEqual({ ok: true })
    await expect(noop.removeActivityHooks()).resolves.toBeUndefined()
    await expect(noop.removeWorktreeSyncHook()).resolves.toBeUndefined()
    await expect(noop.removeWorktreeWatchHook()).resolves.toBeUndefined()
  })
})
