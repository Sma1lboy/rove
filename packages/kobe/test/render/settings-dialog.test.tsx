/** @jsxImportSource @opentui/react */
/**
 * Real-render coverage for the Settings dialog: mount the actual component,
 * walk every section with the real `j` chord, and assert each section's own
 * body content — including the localized Keybindings command-layer block
 * with its live prefix/timeout values.
 */

import { describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { useKV } from "../../src/tui-react/context/kv"
import { PREFIX_TAP_PRESENTATION_KEY } from "../../src/tui/lib/prefix-tap-presentation"
import { act, renderComponent, settle } from "./harness"

const NOOP = (): void => {}

function Driver() {
  const kv = useKV()
  return <SettingsDialog kv={kv} onClose={NOOP} />
}

describe("SettingsDialog", () => {
  it("walks every section with the real j chord and renders each body", async () => {
    process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-settings-"))
    const { frame, mockInput } = await renderComponent(<Driver />, {
      width: 110,
      height: 40,
      providers: { kv: true, dialog: true },
    })

    // General opens first: theme list + the keyboard-hints toggle.
    let text = await frame()
    expect(text).toContain("Theme")
    expect(text).toContain("Show keyboard hints")

    const press = async (key: string): Promise<string> => {
      act(() => mockInput.pressKey(key))
      await settle()
      return await frame()
    }

    // Engines now carries what was the Accounts section: each engine's row is
    // followed by what detection found for it.
    text = await press("j") // → Engines
    expect(text).toContain("Every engine Rove can launch")
    expect(text).toMatch(/\[x\]/) // the on/off switch column
    text = await press("j") // → Plugins
    expect(text).toContain("No plugins registered")
    text = await press("j") // → Keybindings
    expect(text).toContain("Command layer (ctrl+a)")
    expect(text).toContain("5000ms second-stroke window")
    expect(text).toContain("On-screen entries + complete guide (default)")
    expect(text).toContain("Complete guide only")
    expect(text).not.toContain("Fixed (not rebindable)") // FIXED_BINDING_IDS is empty
    text = await press("j") // → Feedback
    expect(text).toContain("GitHub Discussion")
    text = await press("j") // → Dev
    expect(text).toContain("Reset UI state")
  })

  it("selects and persists the prefix-tap presentation with ordinary Settings keys", async () => {
    const home = mkdtempSync(join(tmpdir(), "kobe-prefix-setting-"))
    process.env.KOBE_HOME_DIR = home
    const { frame, mockInput } = await renderComponent(<Driver />, {
      width: 110,
      height: 40,
      providers: { kv: true, dialog: true },
    })

    for (let i = 0; i < 3; i++) {
      act(() => mockInput.pressKey("j"))
      await settle()
    }
    expect(await frame()).toContain("(●) On-screen entries + complete guide (default)")

    act(() => mockInput.pressKey("l"))
    await settle()
    act(() => mockInput.pressKey("j"))
    await settle()
    act(() => mockInput.pressEnter())
    await settle(320)

    expect(await frame()).toContain("(●) Complete guide only")
    const persisted = JSON.parse(readFileSync(join(home, ".config", "rove", "state.json"), "utf8")) as Record<
      string,
      unknown
    >
    expect(persisted[PREFIX_TAP_PRESENTATION_KEY]).toBe("guide")
  })
})
