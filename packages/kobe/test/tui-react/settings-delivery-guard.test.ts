import { describe, expect, it, vi } from "vitest"
import {
  DELIVERY_GUARD_KEY,
  LEGACY_COMPOSER_GATE_KEY,
  deliveryGuardEnvOverride,
  deliveryGuardLayers,
  deliveryGuardPreference,
  nextDeliveryGuard,
  resolveDeliveryGuard,
  setDeliveryGuardPreference,
} from "../../src/state/delivery-guard.ts"

function kvOf(initial: Record<string, unknown> = {}, flushOk = true) {
  const values = new Map<string, unknown>(Object.entries(initial))
  const calls: string[] = []
  return {
    calls,
    values,
    kv: {
      get: (key: string, fallback?: unknown) => values.get(key) ?? fallback,
      set: (key: string, value: unknown) => {
        if (value === undefined) values.delete(key)
        else values.set(key, value)
        calls.push(`set:${key}=${String(value)}`)
      },
      flush: () => {
        calls.push("flush")
        return flushOk
      },
    },
  }
}

describe("delivery guard setting", () => {
  it("defaults to on and honors the legacy boolean as screen-off", () => {
    expect(resolveDeliveryGuard(undefined, undefined, {})).toBe("on")
    expect(resolveDeliveryGuard(undefined, true, {})).toBe("on")
    expect(resolveDeliveryGuard(undefined, false, {})).toBe("screen-off")
    // A stored three-state value wins over the superseded boolean.
    expect(resolveDeliveryGuard("off", false, {})).toBe("off")
    // Garbage is not a third opinion.
    expect(resolveDeliveryGuard("screen-of", undefined, {})).toBe("on")
  })

  it("lets ROVE_DELIVERY_GUARD override the stored value", () => {
    expect(resolveDeliveryGuard("on", undefined, { ROVE_DELIVERY_GUARD: "off" })).toBe("off")
    expect(deliveryGuardEnvOverride({ ROVE_DELIVERY_GUARD: " screen-off " })).toBe("screen-off")
    // An unrecognized value is ignored rather than silently loosening.
    expect(deliveryGuardEnvOverride({ ROVE_DELIVERY_GUARD: "yes" })).toBeUndefined()
    expect(deliveryGuardEnvOverride({})).toBeUndefined()
  })

  it("maps each state to the layers it runs", () => {
    expect(deliveryGuardLayers("on")).toEqual({ humanWrite: true, screen: true })
    expect(deliveryGuardLayers("screen-off")).toEqual({ humanWrite: true, screen: false })
    expect(deliveryGuardLayers("off")).toEqual({ humanWrite: false, screen: false })
  })

  it("cycles on → screen-off → off → on", () => {
    expect(nextDeliveryGuard("on")).toBe("screen-off")
    expect(nextDeliveryGuard("screen-off")).toBe("off")
    expect(nextDeliveryGuard("off")).toBe("on")
  })

  it("persists synchronously, clears the legacy key, and drains only when loosened", () => {
    const { kv, calls, values } = kvOf()
    const drain = vi.fn(() => calls.push("drain"))

    expect(deliveryGuardPreference(kv)).toBe("on")
    expect(setDeliveryGuardPreference(kv, "off", drain)).toBe("saved")
    expect(deliveryGuardPreference(kv)).toBe("off")
    expect(values.has(LEGACY_COMPOSER_GATE_KEY)).toBe(false)
    expect(drain).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([
      `set:${DELIVERY_GUARD_KEY}=off`,
      `set:${LEGACY_COMPOSER_GATE_KEY}=undefined`,
      "flush",
      "drain",
    ])

    // Tightening back is the drain's cancellation signal, not a second drain.
    expect(setDeliveryGuardPreference(kv, "on", drain)).toBe("saved")
    expect(drain).toHaveBeenCalledTimes(1)
  })

  it("restores BOTH keys when the write does not land", () => {
    // The legacy `false` is what the effective value falls back to, so leaving
    // it deleted after a failed flush would loosen the guard invisibly.
    const { kv } = kvOf({ [LEGACY_COMPOSER_GATE_KEY]: false }, false)
    const drain = vi.fn()
    expect(setDeliveryGuardPreference(kv, "off", drain)).toBe("persist-failed")
    expect(drain).not.toHaveBeenCalled()
    expect(deliveryGuardPreference(kv)).toBe("screen-off")
  })
})
