/** @jsxImportSource @opentui/react */
/**
 * Settings → Auto routing (`settings-dialog/sections-auto-routing.tsx`): the
 * gate's verdict is rendered under each tier, so a tier pointed at an engine
 * that is not logged in reads "unavailable" HERE — not at launch. The section
 * takes the hook's result as a prop, so the verdicts are pinned directly.
 */

import { describe, expect, test } from "bun:test"
import { DEFAULT_AUTO_ROUTING } from "../../src/engine/auto-routing"
import { AutoRoutingSettingsSection } from "../../src/tui-react/component/settings-dialog/sections-auto-routing"
import type { AutoRoutingSettings } from "../../src/tui-react/component/settings-dialog/use-auto-routing-settings"
import { renderComponent } from "./harness"

function mount(autoRouting: AutoRoutingSettings) {
  return renderComponent(
    <AutoRoutingSettingsSection
      level="body"
      bodyRow={0}
      setLevel={() => {}}
      setBodyRow={() => {}}
      rowRef={() => () => undefined}
      autoRouting={autoRouting}
    />,
    { width: 120, height: 40, providers: { dialog: true } },
  )
}

describe("AutoRoutingSettingsSection", () => {
  test("a tier whose engine is not logged in says so; the others read ready", async () => {
    const { frame } = await mount({
      table: { ...DEFAULT_AUTO_ROUTING, deep: { engine: "kimi", model: "k2" } },
      block: (tier) => (tier === "deep" ? { kind: "account", engine: "kimi" } : null),
      edit: async () => {},
    })
    const text = await frame()
    expect(text).toContain("unavailable — engine kimi is not logged in")
    expect((text.match(/● ready/g) ?? []).length).toBe(2)
    // The rows show what each tier RUNS; the prose says what it is FOR.
    expect(text).toContain("Claude · sonnet · engine default")
    expect(text).toContain("Kimi · k2 · engine default")
  })

  test("a blanked tier renders the unconfigured warning instead of a table", async () => {
    const { frame } = await mount({ table: null, block: () => undefined, edit: async () => {} })
    expect(await frame()).toContain("Auto routing is off")
  })
})
