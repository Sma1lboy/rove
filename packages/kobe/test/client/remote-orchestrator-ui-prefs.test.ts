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

  it("keeps a payload whose theme is null — state.json names no selection", () => {
    // The daemon has no theme registry, so `null` is its honest answer and the
    // rest of the snapshot must still land. `applyUiPrefs` reads a non-string
    // theme as "leave the current one alone".
    const decoded = decodeUiPrefsPayload({ theme: null, locale: "zh", sortMode: "recent" })
    expect(decoded).not.toBeNull()
    expect(decoded?.theme).toBeNull()
    expect(decoded?.locale).toBe("zh")
    expect(decoded?.sortMode).toBe("recent")
  })

  it("an older daemon's theme-only payload resolves every newer field to its absent-sentinel", () => {
    // The footgun this owns: locale MUST be "" (skip), not "en"; sortMode
    // "default"; keysCollapsed false; projectFilter null. And
    // transparentBackground TRUE — the product default, spelled `!== false` by
    // the two decoders that read the state file. Defaulting it off here was
    // the one field that hard-reset instead of leaving things alone: against
    // an older daemon every remote pane turned opaque while the local ones
    // stayed transparent, with no setting that explained it.
    expect(decodeUiPrefsPayload({ theme: "claude" })).toEqual({
      theme: "claude",
      transparentBackground: true,
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
      transparentBackground: true,
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
    // Only an explicit `false` opts out — the same rule as the state-file side.
    expect(decodeUiPrefsPayload({ theme: "x", transparentBackground: false })?.transparentBackground).toBe(false)
  })
})
