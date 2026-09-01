import type { KeyEvent } from "@opentui/core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CTRL_HOLD_THRESHOLD_MS, createCtrlHoldDetector } from "../../src/tui/lib/ctrl-hold"

function event(name: string, eventType: KeyEvent["eventType"] = "press"): KeyEvent {
  return { name, eventType } as KeyEvent
}

afterEach(() => {
  vi.useRealTimers()
})

describe("ctrl hold detector", () => {
  it.each(["leftctrl", "rightctrl"])("reveals after 400ms for %s and hides on release", (name) => {
    vi.useFakeTimers()
    const events: string[] = []
    const detector = createCtrlHoldDetector({
      onReveal: () => events.push("reveal"),
      onHide: () => events.push("hide"),
    })

    detector.keypress(event(name))
    vi.advanceTimersByTime(CTRL_HOLD_THRESHOLD_MS - 1)
    expect(events).toEqual([])
    vi.advanceTimersByTime(1)
    expect(events).toEqual(["reveal"])

    detector.keyrelease(event(name, "release"))
    expect(events).toEqual(["reveal", "hide"])
  })

  it("cancels a pending or visible reveal on any other key", () => {
    vi.useFakeTimers()
    const events: string[] = []
    const detector = createCtrlHoldDetector({
      onReveal: () => events.push("reveal"),
      onHide: () => events.push("hide"),
    })

    detector.keypress(event("leftctrl"))
    detector.keypress(event("a"))
    vi.advanceTimersByTime(CTRL_HOLD_THRESHOLD_MS)
    expect(events).toEqual([])

    detector.keypress(event("rightctrl"))
    vi.advanceTimersByTime(CTRL_HOLD_THRESHOLD_MS)
    detector.keypress(event("leftshift"))
    expect(events).toEqual(["reveal", "hide"])
  })

  it("does not restart the timer for repeat events from the held ctrl key", () => {
    vi.useFakeTimers()
    const onReveal = vi.fn()
    const detector = createCtrlHoldDetector({ onReveal, onHide: vi.fn() })

    detector.keypress(event("leftctrl"))
    vi.advanceTimersByTime(CTRL_HOLD_THRESHOLD_MS - 50)
    detector.keypress(event("leftctrl", "repeat"))
    vi.advanceTimersByTime(50)

    expect(onReveal).toHaveBeenCalledOnce()
  })

  it("a quick ctrl tap stays invisible", () => {
    vi.useFakeTimers()
    const onReveal = vi.fn()
    const onHide = vi.fn()
    const detector = createCtrlHoldDetector({ onReveal, onHide })

    detector.keypress(event("leftctrl"))
    vi.advanceTimersByTime(120)
    detector.keyrelease(event("leftctrl", "release"))
    vi.advanceTimersByTime(CTRL_HOLD_THRESHOLD_MS)

    expect(onReveal).not.toHaveBeenCalled()
    expect(onHide).not.toHaveBeenCalled()
  })
})
