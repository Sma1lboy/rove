/**
 * Tab-strip visibility: the default, the legacy-boolean migration, and how a
 * mode turns into "does it render".
 *
 * The default is the load-bearing part: with nothing pinning it, a flip
 * rides along in an unrelated change and is only noticed on screen.
 */

import { DEFAULT_TAB_STRIP_MODE, TAB_STRIP_MODES, resolveTabStripMode, tabStripVisible } from "@/state/tab-strip"
import { describe, expect, it } from "vitest"

describe("the default mode", () => {
  it("is `never` — the sidebar tree already lists every tab", () => {
    expect(DEFAULT_TAB_STRIP_MODE).toBe("never")
  })

  it("applies when nothing is stored", () => {
    expect(resolveTabStripMode(undefined, undefined)).toBe("never")
  })

  it("means the strip does not render, whatever the tab count", () => {
    expect(tabStripVisible(DEFAULT_TAB_STRIP_MODE, 1)).toBe(false)
    expect(tabStripVisible(DEFAULT_TAB_STRIP_MODE, 5)).toBe(false)
  })
})

describe("resolveTabStripMode", () => {
  it("honours a stored mode over the default", () => {
    for (const mode of TAB_STRIP_MODES) expect(resolveTabStripMode(mode, undefined)).toBe(mode)
  })

  it("falls back for a stored value that is not a mode", () => {
    // A hand-edited state.json, or a key from a future version.
    expect(resolveTabStripMode("sometimes", undefined)).toBe("never")
    expect(resolveTabStripMode(42, undefined)).toBe("never")
    expect(resolveTabStripMode(null, undefined)).toBe("never")
  })

  it("migrates the legacy boolean when the new key was never written", () => {
    expect(resolveTabStripMode(undefined, true)).toBe("multipleOnly")
    expect(resolveTabStripMode(undefined, false)).toBe("always")
  })

  it("lets the new key win once it exists", () => {
    // Someone who set the legacy toggle and then touched the new setting keeps
    // the new one — otherwise the legacy value would silently outrank it.
    expect(resolveTabStripMode("never", false)).toBe("never")
    expect(resolveTabStripMode("always", true)).toBe("always")
  })
})

describe("tabStripVisible", () => {
  it("`always` renders even for a lone tab", () => {
    expect(tabStripVisible("always", 1)).toBe(true)
  })

  it("`multipleOnly` needs a second tab", () => {
    expect(tabStripVisible("multipleOnly", 1)).toBe(false)
    expect(tabStripVisible("multipleOnly", 2)).toBe(true)
  })

  it("`never` renders nothing", () => {
    expect(tabStripVisible("never", 2)).toBe(false)
  })
})
