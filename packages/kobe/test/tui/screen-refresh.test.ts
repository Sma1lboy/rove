/**
 * screen-refresh — the full-repaint reach into OpenTUI, the self-heal
 * subscriptions, and the user-facing redraw.
 *
 * Pinned here because none of it is observable from a render test: the
 * behavior is "what we ask the renderer to do, and on which platform". The
 * renderer is a fake with the shape OpenTUI's `CliRenderer` exposes,
 * including the two private members this module deliberately reaches for, so
 * no real terminal is spawned.
 *
 * The load-bearing assertions:
 *   - nothing installs off win32 (macOS/Linux keep the frames they emit today);
 *   - every resize AND every focus-in forces exactly one non-diffed frame —
 *     the resize case is the actual fix, since OpenTUI's `processResize`
 *     leaves the flag alone in alternate-screen mode;
 *   - split-footer (inline) hosts are never erased or force-repainted — they
 *     share the main screen with the user's shell.
 */

import { describe, expect, test, vi } from "vitest"
import {
  installScreenSelfHeal,
  needsScreenSelfHeal,
  redrawScreen,
  requestFullRepaint,
  writeThroughRenderer,
} from "../../src/tui/lib/screen-refresh.ts"

function fakeRenderer(screenMode = "alternate-screen") {
  const listeners = new Map<string, Set<() => void>>()
  const self = {
    screenMode,
    /** OpenTUI's private flag — the whole reason `requestFullRepaint` exists. */
    forceFullRepaintRequested: false,
    requestRender: vi.fn(),
    /** OpenTUI's private frame-serialized writer. */
    writeOut: vi.fn(),
    on(event: string, listener: () => void) {
      const set = listeners.get(event) ?? new Set<() => void>()
      set.add(listener)
      listeners.set(event, set)
      return self
    },
    off(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener)
      return self
    },
    emit(event: string): void {
      for (const listener of [...(listeners.get(event) ?? [])]) listener()
    },
    listenerCount(event: string): number {
      return listeners.get(event)?.size ?? 0
    },
  }
  return self
}

describe("needsScreenSelfHeal", () => {
  test("win32 only", () => {
    expect(needsScreenSelfHeal("win32")).toBe(true)
    expect(needsScreenSelfHeal("darwin")).toBe(false)
    expect(needsScreenSelfHeal("linux")).toBe(false)
    expect(needsScreenSelfHeal("freebsd")).toBe(false)
  })
})

describe("requestFullRepaint", () => {
  test("sets OpenTUI's force flag and schedules a frame", () => {
    const renderer = fakeRenderer()
    expect(requestFullRepaint(renderer)).toBe(true)
    expect(renderer.forceFullRepaintRequested).toBe(true)
    expect(renderer.requestRender).toHaveBeenCalledTimes(1)
  })

  test("is a no-op in split-footer, where the flag replays scrollback instead", () => {
    const renderer = fakeRenderer("split-footer")
    expect(requestFullRepaint(renderer)).toBe(false)
    expect(renderer.forceFullRepaintRequested).toBe(false)
    expect(renderer.requestRender).not.toHaveBeenCalled()
  })
})

describe("redrawScreen", () => {
  test("erases the alternate screen through the renderer, then repaints", () => {
    const renderer = fakeRenderer()
    expect(redrawScreen(renderer)).toBe(true)
    expect(renderer.writeOut).toHaveBeenCalledWith("\x1b[H\x1b[2J")
    expect(renderer.forceFullRepaintRequested).toBe(true)
    expect(renderer.requestRender).toHaveBeenCalledTimes(1)
  })

  test("never erases an inline host — that screen belongs to the shell", () => {
    const renderer = fakeRenderer("split-footer")
    expect(redrawScreen(renderer)).toBe(false)
    expect(renderer.writeOut).not.toHaveBeenCalled()
  })
})

describe("writeThroughRenderer", () => {
  test("prefers the renderer's frame-serialized writer", () => {
    const renderer = fakeRenderer()
    const stream = { write: vi.fn() }
    writeThroughRenderer(renderer, "\x07", stream)
    expect(renderer.writeOut).toHaveBeenCalledWith("\x07")
    expect(stream.write).not.toHaveBeenCalled()
  })

  test("falls back to the stream with no renderer, and swallows a throwing write", () => {
    const stream = { write: vi.fn() }
    writeThroughRenderer(null, "\x07", stream)
    expect(stream.write).toHaveBeenCalledWith("\x07")

    const throwing = {
      write: vi.fn(() => {
        throw new Error("EPIPE")
      }),
    }
    expect(() => writeThroughRenderer(undefined, "\x07", throwing)).not.toThrow()
  })
})

describe("installScreenSelfHeal", () => {
  test("every resize forces exactly one non-diffed frame", () => {
    const renderer = fakeRenderer()
    installScreenSelfHeal({ renderer, platform: "win32" })

    renderer.emit("resize")
    expect(renderer.forceFullRepaintRequested).toBe(true)
    expect(renderer.requestRender).toHaveBeenCalledTimes(1)

    // OpenTUI clears the flag when it renders the forced frame; the next
    // resize has to set it again rather than ride the first one.
    renderer.forceFullRepaintRequested = false
    renderer.emit("resize")
    expect(renderer.forceFullRepaintRequested).toBe(true)
    expect(renderer.requestRender).toHaveBeenCalledTimes(2)
  })

  test("a focus-in repaints too — a reflow that keeps the cell grid emits no resize", () => {
    const renderer = fakeRenderer()
    installScreenSelfHeal({ renderer, platform: "win32" })
    renderer.emit("focus")
    expect(renderer.forceFullRepaintRequested).toBe(true)
    expect(renderer.requestRender).toHaveBeenCalledTimes(1)
  })

  test("subscribes to nothing off win32", () => {
    const renderer = fakeRenderer()
    const detach = installScreenSelfHeal({ renderer, platform: "darwin" })
    expect(renderer.listenerCount("resize")).toBe(0)
    expect(renderer.listenerCount("focus")).toBe(0)
    renderer.emit("resize")
    renderer.emit("focus")
    expect(renderer.requestRender).not.toHaveBeenCalled()
    expect(() => detach()).not.toThrow()
  })

  test("an inline host subscribes but repaints nothing", () => {
    const renderer = fakeRenderer("split-footer")
    installScreenSelfHeal({ renderer, platform: "win32" })
    renderer.emit("resize")
    expect(renderer.forceFullRepaintRequested).toBe(false)
    expect(renderer.requestRender).not.toHaveBeenCalled()
  })

  test("detach unsubscribes both events", () => {
    const renderer = fakeRenderer()
    const detach = installScreenSelfHeal({ renderer, platform: "win32" })
    expect(renderer.listenerCount("resize")).toBe(1)
    expect(renderer.listenerCount("focus")).toBe(1)

    detach()
    expect(renderer.listenerCount("resize")).toBe(0)
    expect(renderer.listenerCount("focus")).toBe(0)

    renderer.emit("resize")
    expect(renderer.requestRender).not.toHaveBeenCalled()
  })
})
