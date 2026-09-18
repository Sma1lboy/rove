/** @jsxImportSource @opentui/react */
/**
 * Settings → Auto effort (`settings-dialog/sections-auto-effort.tsx`): the
 * gate's verdict is rendered under each tier, so a tier pointed at an engine
 * that is not logged in reads "unavailable" HERE — not at launch. The section
 * takes the hook's result as a prop, so the verdicts are pinned directly.
 */

import { describe, expect, test } from "bun:test"
import { DEFAULT_AUTO_EFFORT } from "../../src/engine/auto-effort"
import { AutoEffortSettingsSection } from "../../src/tui-react/component/settings-dialog/sections-auto-effort"
import type { AutoEffortSettings } from "../../src/tui-react/component/settings-dialog/use-auto-effort-settings"
import { renderComponent } from "./harness"

function mount(autoEffort: AutoEffortSettings) {
  return renderComponent(
    <AutoEffortSettingsSection
      level="body"
      bodyRow={0}
      setLevel={() => {}}
      setBodyRow={() => {}}
      rowRef={() => () => undefined}
      autoEffort={autoEffort}
    />,
    { width: 120, height: 40, providers: { dialog: true } },
  )
}

describe("AutoEffortSettingsSection", () => {
  test("a tier whose engine is not logged in says so; the others read ready", async () => {
    const { frame } = await mount({
      table: { ...DEFAULT_AUTO_EFFORT, deep: { engine: "kimi", model: "k2" } },
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
    expect(await frame()).toContain("Auto effort is off")
  })
})
