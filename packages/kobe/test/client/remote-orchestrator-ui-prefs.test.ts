/**
 * `decodeUiPrefsPayload`'s backward-compat defaults — the one owner of "an
 * older daemon omitted this field, so resolve it to its absent-means-leave-it
 * sentinel", pinned field by field.
 *
 * Split from `remote-orchestrator.test.ts` on the same line the source is
 * split: pure payload decoding here, the orchestrator's channel plumbing
 * (subscriptions, capability gating, malformed-event logging) there. These
 * need no client, no bus and no harness — only the decoder and a literal.
 */

import { describe, expect, it } from "vitest"
import { decodeUiPrefsPayload } from "../../src/client/remote-orchestrator.ts"

describe("decodeUiPrefsPayload — backward-compat defaults", () => {
  it("drops a payload with no theme string", () => {
    expect(decodeUiPrefsPayload(undefined)).toBeNull()
    expect(decodeUiPrefsPayload({})).toBeNull()
    expect(decodeUiPrefsPayload({ theme: 42 })).toBeNull()
  })

  it("an older daemon's theme-only payload resolves every newer field to its absent-sentinel", () => {
    // The footgun this owns: locale MUST be "" (skip), not "en"; sortMode
    // "default"; keysCollapsed false; projectFilter null; transparent off.
    expect(decodeUiPrefsPayload({ theme: "claude" })).toEqual({
      theme: "claude",
      transparentBackground: false,
      focusAccent: null,
      locale: "",
      sortMode: "default",
      keysCollapsed: false,
      projectFilter: null,
    })
  })

  it("carries real values through and normalizes odd ones", () => {
    expect(
      decodeUiPrefsPayload({ theme: "tokyonight", locale: "zh-CN", sortMode: "recent", keysCollapsed: true }),
    ).toEqual({
      theme: "tokyonight",
      transparentBackground: false,
      focusAccent: null,
      locale: "zh-CN",
      sortMode: "recent",
      keysCollapsed: true,
      projectFilter: null,
    })
    // empty projectFilter string → null (all projects); unknown sortMode → default
    const d = decodeUiPrefsPayload({ theme: "x", projectFilter: "", sortMode: "weird", focusAccent: "#abc" })
    expect(d?.projectFilter).toBeNull()
    expect(d?.sortMode).toBe("default")
    expect(d?.focusAccent).toBe("#abc")
  })
})
