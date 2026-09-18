/**
 * Settings → Marketplace joins a GitHub listing with the local registry. The
 * join is what stops the section offering a second copy of something already
 * installed — and it must not confuse a linked plugin (whose `source` is a
 * local path) with a marketplace ref.
 */

import { describe, expect, it } from "vitest"
import type { MarketEntry } from "../../src/cli/plugin-search.ts"
import {
  installedSpecIds,
  marketplaceRowViews,
} from "../../src/tui-react/component/settings-dialog/marketplace-core.ts"
import type { PluginRowView } from "../../src/tui-react/component/settings-dialog/plugins-core.ts"

function plugin(overrides: Partial<PluginRowView>): PluginRowView {
  return {
    id: "example.plugin",
    version: "1.0.0",
    enabled: true,
    linked: false,
    source: "you/rove-thing",
    declares: null,
    platformOk: true,
    hooksDeclared: false,
    lastRun: null,
    settings: [],
    updateAvailable: false,
    ...overrides,
  }
}

const LISTING: readonly MarketEntry[] = [
  { ref: "you/rove-thing", desc: "a thing", stars: 12 },
  { ref: "Sma1lboy/kobe-plugins/notify", desc: "notifications", firstParty: true },
]

describe("marketplace row views", () => {
  it("marks a listed ref that the registry already has, by its registry id", () => {
    const rows = marketplaceRowViews(LISTING, [plugin({ id: "acme.thing", source: "you/rove-thing" })])

    expect(rows.map((r) => [r.ref, r.installedId])).toEqual([
      ["you/rove-thing", "acme.thing"],
      ["Sma1lboy/kobe-plugins/notify", null],
    ])
  })

  it("matches regardless of the case GitHub reports the owner in", () => {
    const rows = marketplaceRowViews([{ ref: "You/Rove-Thing", desc: "" }], [plugin({ source: "you/rove-thing" })])

    expect(rows[0]?.installedId).toBe("example.plugin")
  })

  it("ignores linked plugins, whose source is a directory and never a ref", () => {
    // A linked plugin's `source` is an absolute path. Feeding it to the join
    // would compare a path against `owner/repo` — never equal, but it would
    // also mean a linked copy silently permits a second managed install.
    const linked = plugin({ id: "local.dev", linked: true, source: "/home/me/plugins/rove-thing" })

    expect(installedSpecIds([linked]).size).toBe(0)
    expect(marketplaceRowViews(LISTING, [linked]).every((r) => r.installedId === null)).toBe(true)
  })

  it("carries stars and the first-party flag through for the row's tag", () => {
    const rows = marketplaceRowViews(LISTING, [])

    expect(rows[0]).toMatchObject({ stars: 12, firstParty: false })
    expect(rows[1]).toMatchObject({ stars: null, firstParty: true })
  })
})
