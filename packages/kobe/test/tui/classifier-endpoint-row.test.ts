/**
 * What the Settings endpoint row shows (`displayEndpoint`).
 *
 * Lives in the framework-free settings model rather than in the hook, so it
 * can be asserted without dragging in OpenTUI's React reconciler — and
 * because "what does this row say" is model, not rendering.
 *
 * Pulled out as a pure function because the bug it exists to stop
 * was a one-line fallback, invisible to every test in the suite and obvious
 * the moment the screen was photographed: the row read the raw mode key when
 * nothing else was available, and in `jev` mode that key holds the string
 * `jev` — so the row rendered `Endpoint  jev`, an address nobody typed and
 * nothing would POST to.
 */

import { describe, expect, it } from "vitest"
import { displayEndpoint } from "../../src/tui/component/settings-dialog/model.ts"

describe("displayEndpoint", () => {
  it("never shows the mode NAME as an address", () => {
    // The regression. `jev` is a mode, not somewhere to POST.
    expect(displayEndpoint("jev", "jev", "")).toBe("")
    expect(displayEndpoint("jev", "jev", "https://remembered/pick")).toBe("https://remembered/pick")
    expect(displayEndpoint("off", "off", "")).toBe("")
  })

  it("shows the live URL in custom mode", () => {
    expect(displayEndpoint("url", "https://live/pick", "https://remembered/pick")).toBe("https://live/pick")
  })

  it("shows a REFUSED address, which is the only way to see the typo", () => {
    // A non-loopback `http://` is stored but never posted to. Hiding it would
    // leave the user with a classifier that silently does nothing and a row
    // that says nothing is configured.
    expect(displayEndpoint("refused", "http://tiers.internal/pick", "")).toBe("http://tiers.internal/pick")
  })

  it("falls back to the remembered address when the mode points elsewhere", () => {
    expect(displayEndpoint("off", "off", "https://remembered/pick")).toBe("https://remembered/pick")
  })
})
