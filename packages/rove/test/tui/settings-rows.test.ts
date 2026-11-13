/**
 * Settings dialog row registry (settings-dialog/model.ts). Keyboard nav and
 * every section view's cursor highlight key off "a row's body index is its
 * position in the section's row list", so these pin the positional contracts
 * the views rely on and the id-lookup helpers they use instead of arithmetic.
 */

import { describe, expect, it } from "vitest"
import { humanizeSlug } from "../../src/engine/interactive-command.ts"
import {
  SECTIONS,
  type SettingsRowsInput,
  devRows,
  engineRowId,
  engineRows,
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
      { id: "example.notify", settingKeys: ["ROVE_NOTIFY_SOUND"] },
      { id: "acme.layout", settingKeys: [] },
    ],
    marketplace: ["Sma1lboy/rove-plugins/notify", "you/rove-thing"],
    hasDaemon: true,
    ...overrides,
  }
}

describe("generalRows", () => {
  it("keeps language first and every row id unique", () => {
    const rows = generalRows()
    expect(rows.slice(0, LANG).map((r) => (r.kind === "language" ? r.locale : "?"))).toEqual(LOCALES.map((l) => l.id))
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
  })
})

describe("engineRows", () => {
  it("is one row per engine, then the add row, then the integration and skill buttons", () => {
    const customs = ["aider", "goose"]
    const list = [...ALL_VENDORS, ...customs]
    const rows = engineRows(list)
    expect(rows.length).toBe(ALL_VENDORS.length + customs.length + 4)
    // Engine row index === its position in the engine list (the section's <For> order).
    expect(list.map((vendor) => rowIndex(rows, engineRowId(vendor)))).toEqual(list.map((_, i) => i))
    expect(rows.slice(0, list.length).map((row) => row.kind === "engine" && row.vendor)).toEqual(list)
    // The add row sits at index === engine count (the section's addRowIndex),
    // then the buttons in the order they render: hooks install, hooks remove,
    // skill install. The view keys off `addRowIndex + 1` / `+ 2` / `+ 3`.
    expect(rowAt(rows, list.length)?.kind).toBe("engineAdd")
    expect(rowAt(rows, list.length + 1)?.kind).toBe("engineHooksInstall")
    expect(rowAt(rows, list.length + 2)?.kind).toBe("engineHooksUninstall")
    expect(rowAt(rows, list.length + 3)?.kind).toBe("engineSkillInstall")
  })

  it("with zero custom engines still ends with the add row", () => {
    const rows = engineRows(ALL_VENDORS)
    expect(rows.length).toBe(ALL_VENDORS.length + 4)
    expect(rows.at(-4)?.kind).toBe("engineAdd")
  })
})

describe("devRows", () => {
  it("offers the daemon restart row only when there is a daemon", () => {
    const withDaemon = devRows(true).map((r) => r.kind)
    expect(withDaemon).toContain("devRestartDaemon")
    expect(devRows(false).map((r) => r.kind)).toEqual(withDaemon.filter((kind) => kind !== "devRestartDaemon"))
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

describe("sectionRows", () => {
  it("keys lists the prefix key and every rebindable binding, and never a fixed or doc-only one", () => {
    const rows = sectionRows("keys", input())
    expect(rows.slice(0, 2).map((r) => r.kind)).toEqual(["prefixTapPresentation", "prefixTapPresentation"])
    const ids = rows.flatMap((r) => (r.kind === "keybinding" ? [r.bindingId] : []))
    expect(ids[0]).toBe("prefix.key")
    expect(ids).toContain("focus.sidebar")
    expect(ids).not.toContain("chat.send")
  })

  it.each(SECTIONS.map((section) => section.id))("row ids are unique within the %s section", (id) => {
    const ids = sectionRows(id, input({ engineList: [...ALL_VENDORS, "aider"] })).map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("rowIndex / rowAt", () => {
  it("returns -1 / undefined for unknown id or out-of-range index", () => {
    const rows = generalRows()
    expect(rowIndex(rows, "no-such-row")).toBe(-1)
    expect(rowAt(rows, -1)).toBeUndefined()
    expect(rowAt(rows, rows.length)).toBeUndefined()
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
