/**
 * Shared terminal-size store: however many components read the size, the
 * renderer carries ONE `resize` listener — a dozen per-caller listeners is
 * what printed MaxListenersExceededWarning into the terminal.
 */

import { EventEmitter } from "node:events"
import { describe, expect, it } from "vitest"
import { terminalSizeStore } from "../../src/tui/lib/terminal-size-store"

class FakeRenderer extends EventEmitter {
  width = 120
  height = 40
  resize(width: number, height: number) {
    this.width = width
    this.height = height
    this.emit("resize", width, height)
  }
}

describe("terminal size store", () => {
  it("holds one renderer listener for many subscribers and drops it after the last", () => {
    const renderer = new FakeRenderer()
    const store = terminalSizeStore(renderer)
    const unsubscribes = Array.from({ length: 20 }, () => store.subscribe(() => {}))
    expect(renderer.listenerCount("resize")).toBe(1)
    for (const unsubscribe of unsubscribes) unsubscribe()
    expect(renderer.listenerCount("resize")).toBe(0)
  })

  it("notifies every subscriber and changes the snapshot only when the size does", () => {
    const renderer = new FakeRenderer()
    const store = terminalSizeStore(renderer)
    let calls = 0
    const a = store.subscribe(() => calls++)
    const b = store.subscribe(() => calls++)
    const before = store.snapshot()
    expect(store.snapshot()).toBe(before)
    renderer.resize(80, 24)
    expect(calls).toBe(2)
    expect(store.snapshot()).toEqual({ width: 80, height: 24 })
    expect(store.snapshot()).not.toBe(before)
    a()
    b()
  })

  it("reads a resize that happened while nobody was subscribed", () => {
    const renderer = new FakeRenderer()
    const store = terminalSizeStore(renderer)
    store.subscribe(() => {})()
    renderer.width = 60
    expect(store.snapshot().width).toBe(60)
  })
})
