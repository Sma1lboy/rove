import { describe, expect, it, vi } from "vitest"
import { composerGatePreferenceOn, toggleComposerGatePreference } from "../../src/state/composer-gate.ts"

describe("composer delivery check setting", () => {
  it("flushes only on the enabled-to-disabled transition", () => {
    const values = new Map<string, unknown>()
    const calls: string[] = []
    const kv = {
      get: (key: string, fallback?: unknown) => values.get(key) ?? fallback,
      set: (key: string, value: unknown) => {
        values.set(key, value)
        calls.push(`set:${String(value)}`)
      },
      flush: () => {
        calls.push("flush")
        return true
      },
    }
    const drain = vi.fn(() => calls.push("drain"))

    expect(composerGatePreferenceOn(kv)).toBe(true)
    expect(toggleComposerGatePreference(kv, drain)).toBe("disabled")
    expect(composerGatePreferenceOn(kv)).toBe(false)
    expect(drain).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(["set:false", "flush", "drain"])

    expect(toggleComposerGatePreference(kv, drain)).toBe("enabled")
    expect(composerGatePreferenceOn(kv)).toBe(true)
    expect(drain).toHaveBeenCalledTimes(1)
  })

  it("does not drain when the disabled value could not be persisted", () => {
    const drain = vi.fn()
    const kv = {
      get: () => true,
      set: () => {},
      flush: () => false,
    }

    expect(toggleComposerGatePreference(kv, drain)).toBe("persist-failed")
    expect(drain).not.toHaveBeenCalled()
  })
})
