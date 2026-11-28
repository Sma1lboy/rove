import { describe, expect, test } from "vitest"
import {
  TUI_NOTE_CLIENTS,
  WEB_NOTE_CLIENTS,
  entryClients,
  groupReleaseNotes,
  stripEntryClientTag,
} from "../../src/lib/release-note-clients"

const PR =
  "[#2237](https://github.com/Sma1lboy/rove/pull/2237) [`db9b931`](https://github.com/Sma1lboy/rove/commit/db9b931)"

describe("entryClients", () => {
  test("reads bold client tags, link-stripped TUI form, and conventional commit scopes", () => {
    expect(entryClients(`- ${PR} **tui** Press / to search.`)).toEqual(["tui"])
    expect(entryClients(`- ${PR} **web · ios** On a phone, …`)).toEqual(["web", "ios"])
    expect(entryClients("- #2237 `db9b931` **daemon** The daemon …")).toEqual(["daemon"])
    expect(entryClients(`- ${PR} fix(web): Shift+Enter adds a newline.`)).toEqual(["web"])
    expect(entryClients(`- ${PR} feat(ios): haptic feedback on tap.`)).toEqual(["ios"])
    expect(entryClients(`- ${PR} refactor(tui-react): simplify layout.`)).toEqual(["tui"])
  })

  test("untagged and malformed entries are untagged", () => {
    expect(entryClients(`- ${PR} The Files pane lists …`)).toBeNull()
    expect(entryClients(`- ${PR} **mac** Unknown client.`)).toBeNull()
    expect(entryClients(`- ${PR} **Web** Capitalised.`)).toBeNull()
    expect(entryClients(`- ${PR} Text with **bold** inside.`)).toBeNull()
    expect(entryClients(`- ${PR} fix(landing): typo on marketing page.`)).toBeNull()
  })
})

describe("stripEntryClientTag", () => {
  test("removes leading valid client tag while preserving PR link and inner bold text", () => {
    expect(stripEntryClientTag(`- ${PR} **web · ios** Use **Install Rove** button.`)).toBe(
      `- ${PR} Use **Install Rove** button.`,
    )
    expect(stripEntryClientTag("- #2266 `36e4854` **tui · daemon** Cleanup attachments.")).toBe(
      "- #2266 `36e4854` Cleanup attachments.",
    )
    expect(stripEntryClientTag(`- ${PR} **mac** Keep unknown tag.`)).toBe(`- ${PR} **mac** Keep unknown tag.`)
  })
})

describe("groupReleaseNotes", () => {
  const mixedChangelog = [
    "### Patch Changes",
    "",
    `- ${PR} **tui · daemon** Cleanup pasted TUI images.`,
    "",
    `- ${PR} **web · ios** Phone glass.`,
    "  A wrapped line of the phone entry.",
    "",
    `- ${PR} **web** Desktop sidebar multi-select.`,
    "",
    `- ${PR} fix(web): Shift+Enter adds a newline.`,
    "",
    `- ${PR} **tui** Files search.`,
    "",
    `- ${PR} **cli** Signed macOS dmg.`,
    "",
    `- ${PR} Untagged, shown everywhere.`,
    "",
    `- ${PR} **android** Android only.`,
  ].join("\n")

  test("groups mixed CHANGELOG snippet into ordered scope sections per client, dropping inline tags and patch-only heading", () => {
    const web = groupReleaseNotes(mixedChangelog, WEB_NOTE_CLIENTS)
    expect(web.hasSignificantBump).toBe(false)
    expect(web.hasScopedEntries).toBe(true)
    expect(web.own).toHaveLength(1)
    expect(web.own[0]?.heading).toBeNull()
    expect(web.own[0]?.sections.map((s) => [s.scope, s.count])).toEqual([
      ["ios", 1],
      ["web", 2],
      ["daemon", 1],
      ["other", 1],
    ])
    // Multi-tag `web · ios` appears once under ios with inline tag stripped and PR link kept.
    expect(web.own[0]?.sections[0]?.entries[0]).toContain("[#2237](https://github.com/Sma1lboy/rove/pull/2237)")
    expect(web.own[0]?.sections[0]?.entries[0]).toContain("Phone glass.\n  A wrapped line of the phone entry.")
    expect(web.own[0]?.sections[0]?.entries[0]).not.toContain("**web · ios**")
    // `tui · daemon` lands under daemon on web with inline tag dropped.
    expect(web.own[0]?.sections[2]?.entries[0]).toContain("Cleanup pasted TUI images.")
    expect(web.own[0]?.sections[2]?.entries[0]).not.toContain("**tui · daemon**")
    // Folded other-client sections keep their own scope grouping.
    expect(web.otherCount).toBe(3)
    expect(web.other[0]?.heading).toBeNull()
    expect(web.other[0]?.sections.map((s) => [s.scope, s.count])).toEqual([
      ["tui", 1],
      ["cli", 1],
      ["android", 1],
    ])

    const tui = groupReleaseNotes(mixedChangelog, TUI_NOTE_CLIENTS)
    expect(tui.own[0]?.sections.map((s) => [s.scope, s.count])).toEqual([
      ["tui", 2],
      ["cli", 1],
      ["other", 1],
    ])
    expect(tui.otherCount).toBe(4)
    expect(tui.other[0]?.sections.map((s) => [s.scope, s.count])).toEqual([
      ["ios", 1],
      ["web", 2],
      ["android", 1],
    ])
  })

  test("keeps bump headings when a release includes minor or major changes", () => {
    const minorBody = [
      "### Minor Changes",
      "",
      `- ${PR} **web** New workspace tabs.`,
      "",
      "### Patch Changes",
      "",
      `- ${PR} **web** Fix tab flicker.`,
      "",
      `- ${PR} **tui** Fix cursor jump.`,
    ].join("\n")

    const grouped = groupReleaseNotes(minorBody, WEB_NOTE_CLIENTS)
    expect(grouped.hasSignificantBump).toBe(true)
    expect(grouped.own.map((g) => g.heading)).toEqual(["Minor Changes", "Patch Changes"])
    expect(grouped.other.map((g) => g.heading)).toEqual(["Patch Changes"])
  })

  test("omits Chinese Patch Changes heading on patch-only releases and flags untagged-only releases", () => {
    const zhPatch = `### 补丁更新\n\n- ${PR} 第一条。\n\n- ${PR} 第二条。`
    const grouped = groupReleaseNotes(zhPatch, TUI_NOTE_CLIENTS)
    expect(grouped.hasSignificantBump).toBe(false)
    expect(grouped.hasScopedEntries).toBe(false)
    expect(grouped.own[0]?.heading).toBeNull()
    expect(grouped.own[0]?.sections).toEqual([
      { scope: "other", count: 2, entries: [`- ${PR} 第一条。`, `- ${PR} 第二条。`] },
    ])
    expect(grouped.otherCount).toBe(0)
  })
})
