import { afterEach, describe, expect, test } from "bun:test"
import { canFrame } from "../src/browser-url.ts"
import { browserPanelKey, hasDesktopBrowser, queueAdoptedTab, takeAdoptedTab } from "../src/desktop-browser.ts"

const local = { origin: "http://127.0.0.1:7961", hostname: "127.0.0.1" }
const remote = { origin: "https://rove.example.com", hostname: "rove.example.com" }

afterEach(() => {
  ;(globalThis as { window?: unknown }).window = undefined
})

describe("native desktop browser rules", () => {
  test("native mode allows https, plain external http, and localhost while still refusing Rove itself", () => {
    expect(canFrame("https://github.com/Sma1lboy/rove", local, true, true)).toBe("yes")
    expect(canFrame("http://example.com/", local, true, true)).toBe("yes")
    expect(canFrame("http://localhost:5173/", remote, false, true)).toBe("yes")
    expect(canFrame("http://127.0.0.1:7961/#token=x", local, true, true)).toBe("self")
  })

  test("iframe fallback mode keeps existing restrictions when native is false", () => {
    expect(canFrame("http://example.com/", local, true, false)).toBe("unreachable")
    expect(canFrame("http://localhost:5173/", remote, false, false)).toBe("remote")
  })

  test("hasDesktopBrowser detects window.roveDesktop.browser and falls back cleanly without it", () => {
    expect(hasDesktopBrowser()).toBe(false)
    ;(globalThis as { window?: unknown }).window = {}
    expect(hasDesktopBrowser()).toBe(false)
    ;(globalThis as { window?: unknown }).window = { roveDesktop: { browser: {} } }
    expect(hasDesktopBrowser()).toBe(true)
  })

  test("pending tab adoption consumes once per panelKey", () => {
    const key = browserPanelKey("task-1", "t2")
    queueAdoptedTab(key, "b-7")
    expect(takeAdoptedTab(key)).toBe("b-7")
    expect(takeAdoptedTab(key)).toBeUndefined()
  })
})
