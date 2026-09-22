/**
 * Settings dialog row registry (settings-dialog/model.ts).
 *
 * Why these tests matter: the dialog's keyboard nav (j/k/enter), the
 * engines-section row-gated keys (r/x/d), and every section view's
 * cursor highlight all key off "a row's body index is its position in
 * the section's row list". The alternative is hand-chained
 * offset arithmetic (transparentRowIndex = themeCount, toastRowIndex =
 * themeCount+1+accentCount, ...) where one insertion shifts every
 * downstream index. These tests pin (a) the exact on-screen row ORDER
 * per section, (b) count parity with those offset formulas for
 * representative input sizes, and (c) the id-lookup helpers the views
 * use instead of arithmetic. If a row is added or reordered, the order
 * test here is the single place that must change with it.
 */

import { describe, expect, it } from "vitest"
import { humanizeSlug } from "../../src/engine/interactive-command.ts"
import {
  SECTIONS,
  type SettingsRowsInput,
  bodyRowCount,
  devRows,
  engineRowId,
  engineRows,
  feedbackRows,
  generalRows,
  pluginRowId,
  pluginRows,
  pluginSettingRowId,
  rowAt,
  rowIndex,
  sectionRows,
} from "../../src/tui/component/settings-dialog/model.ts"
import { LOCALES } from "../../src/tui/i18n/catalog.ts"
import { ALL_VENDORS } from "../../src/types/vendor.ts"

/** Language picker rows sit right after the theme list — count them in the offsets. */
const LANG = LOCALES.length

function input(overrides: Partial<SettingsRowsInput> = {}): SettingsRowsInput {
  return {
    engineList: [...ALL_VENDORS],
    plugins: [
      { id: "example.notify", settingKeys: ["KOBE_NOTIFY_SOUND"] },
      { id: "acme.layout", settingKeys: [] },
    ],
    marketplace: ["Sma1lboy/kobe-plugins/notify", "you/rove-thing"],
    hasDaemon: true,
    keybindingsFileExists: true,
    ...overrides,
  }
}

describe("generalRows", () => {
  it("keeps language first and each appearance setting reachable exactly once", () => {
    const rows = generalRows()
    expect(rows.slice(0, LANG).map((r) => (r.kind === "language" ? r.locale : "?"))).toEqual(LOCALES.map((l) => l.id))
    expect(rows.slice(LANG, LANG + 6)).toEqual(
      ["theme", "transparent", "focusAccent", "splitStyle", "railFold", "tabRowHeight"].map((setting) => ({
        id: `appearance:${setting}`,
        kind: "appearance",
        setting,
      })),
    )
    expect(rowIndex(rows, "toast")).toBe(LANG + 6)
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
  })
})

describe("engineRows", () => {
  it("is one row per engine, then the add row, then the two integration buttons", () => {
    const customs = ["aider", "goose"]
    const list = [...ALL_VENDORS, ...customs]
    const rows = engineRows(list)
    expect(rows.length).toBe(ALL_VENDORS.length + customs.length + 3)
    // Engine row index === its position in the engine list (the section's <For> order).
    list.forEach((vendor, i) => {
      expect(rowIndex(rows, engineRowId(vendor))).toBe(i)
      const row = rowAt(rows, i)
      expect(row?.kind === "engine" && row.vendor).toBe(vendor)
    })
    // The add row sits at index === engine count (the section's addRowIndex),
    // and the two integration buttons close the section in the order they
    // render: install first, remove beside it. The view keys off
    // `addRowIndex + 1` / `+ 2`, so the pair must stay adjacent and in order.
    expect(rowAt(rows, list.length)?.kind).toBe("engineAdd")
    expect(rowAt(rows, list.length + 1)?.kind).toBe("engineHooksInstall")
    expect(rows.at(-1)?.kind).toBe("engineHooksUninstall")
  })

  it("with zero custom engines still ends with the add row", () => {
    const rows = engineRows(ALL_VENDORS)
    expect(rows.length).toBe(ALL_VENDORS.length + 3)
    expect(rows.at(-3)?.kind).toBe("engineAdd")
    expect(rows.at(-2)?.kind).toBe("engineHooksInstall")
    expect(rows.at(-1)?.kind).toBe("engineHooksUninstall")
  })
})

describe("devRows", () => {
  it("with a daemon: reset, restart, then the experimental toggles in order", () => {
    const rows = devRows(true)
    expect(rows.map((r) => r.kind)).toEqual([
      "devReset",
      "devRestartDaemon",
      "devRemoteProjects",
      "devAutoStatus",
      "devDispatcher",
    ])
    expect(rowIndex(rows, "remote-projects")).toBe(2)
    expect(rowIndex(rows, "auto-status")).toBe(3)
    expect(rowIndex(rows, "dispatcher")).toBe(4)
  })

  it("without a daemon: the same list, one row shorter, indices shifted by one", () => {
    const rows = devRows(false)
    expect(rows.map((r) => r.kind)).toEqual(["devReset", "devRemoteProjects", "devAutoStatus", "devDispatcher"])
    expect(rowIndex(rows, "remote-projects")).toBe(1)
    expect(rowIndex(rows, "auto-status")).toBe(2)
    expect(rowIndex(rows, "dispatcher")).toBe(3)
  })
})

describe("pluginRows", () => {
  it("nests each plugin's declared settings right under its toggle row", () => {
    const rows = pluginRows([
      { id: "example.notify", settingKeys: ["SOUND", "DELAY"] },
      { id: "acme.layout", settingKeys: [] },
    ])
    expect(rows.map((r) => r.kind)).toEqual(["pluginToggle", "pluginSetting", "pluginSetting", "pluginToggle"])
    expect(rowIndex(rows, pluginSettingRowId("example.notify", "DELAY"))).toBe(2)
    expect(rowIndex(rows, pluginRowId("acme.layout"))).toBe(3)
    const setting = rowAt(rows, 1)
    expect(setting?.kind === "pluginSetting" && setting.key).toBe("SOUND")
  })

  it("is one row per plugin when nothing declares settings, and empty for an empty registry", () => {
    expect(pluginRows([{ id: "a", settingKeys: [] }]).map((r) => r.kind)).toEqual(["pluginToggle"])
    expect(pluginRows([])).toEqual([])
  })
})

describe("feedbackRows", () => {
  it("is title, body, send (old feedbackRowCount === 3)", () => {
    expect(feedbackRows().map((r) => r.kind)).toEqual(["feedbackTitle", "feedbackBody", "feedbackSend"])
  })
})

describe("sectionRows / bodyRowCount", () => {
  it("keys has no rows once the YAML exists, and one create action while it doesn't", () => {
    expect(sectionRows("keys", input()).map((r) => r.kind)).toEqual(["prefixTapPresentation", "prefixTapPresentation"])
    expect(sectionRows("keys", input({ keybindingsFileExists: false })).map((r) => r.kind)).toEqual([
      "prefixTapPresentation",
      "prefixTapPresentation",
      "keysCreate",
    ])
  })

  it("bodyRowCount is the registry length for every section", () => {
    const inp = input({ engineList: [...ALL_VENDORS, "aider"], hasDaemon: false })
    for (const { id } of SECTIONS) {
      expect(bodyRowCount(id, inp)).toBe(sectionRows(id, inp).length)
    }
  })

  it("matches the old per-section count formulas for a representative input", () => {
    const inp = input({ engineList: [...ALL_VENDORS, "aider", "goose"], hasDaemon: true })
    expect(bodyRowCount("general", inp)).toBe(LANG + 6 + 12) // language + appearance summaries + remaining preferences
    expect(bodyRowCount("engines", inp)).toBe(ALL_VENDORS.length + 2 + 3) // built-ins + 2 custom + add + install + remove
    expect(bodyRowCount("autoEffort", inp)).toBe(3 + 4) // three tiers, then classifier / endpoint / floor / key
    expect(bodyRowCount("keys", inp)).toBe(2)
    expect(bodyRowCount("marketplace", inp)).toBe(2)
    expect(bodyRowCount("marketplace", { ...inp, marketplace: [] })).toBe(0)
    expect(bodyRowCount("feedback", inp)).toBe(3)
    // reset + restart + 3 experimental toggles; one fewer without a daemon.
    expect(bodyRowCount("dev", inp)).toBe(5)
    expect(bodyRowCount("dev", { ...inp, hasDaemon: false })).toBe(4)
  })

  it("row ids are unique within every section", () => {
    const inp = input({ engineList: [...ALL_VENDORS, "aider"] })
    for (const { id } of SECTIONS) {
      const ids = sectionRows(id, inp).map((r) => r.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe("rowIndex / rowAt", () => {
  it("returns -1 / undefined for unknown id or out-of-range index", () => {
    const rows = generalRows()
    expect(rowIndex(rows, "no-such-row")).toBe(-1)
    expect(rowAt(rows, -1)).toBeUndefined()
    expect(rowAt(rows, rows.length)).toBeUndefined()
  })

  it("looks a theme row up by id", () => {
    const rows = generalRows()
    // The theme list opens the Appearance group, which follows the languages.
    expect(rowIndex(rows, "appearance:theme")).toBe(LANG)
  })
})

describe("humanizeSlug", () => {
  it("title-cases hyphen/underscore-separated words", () => {
    expect(humanizeSlug("my-local-agent")).toBe("My Local Agent")
    expect(humanizeSlug("my_local_agent")).toBe("My Local Agent")
    expect(humanizeSlug("aider")).toBe("Aider")
  })

  it("drops empty segments from doubled/leading separators", () => {
    expect(humanizeSlug("--weird--slug-")).toBe("Weird Slug")
    expect(humanizeSlug("")).toBe("")
  })
})
