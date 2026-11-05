/** @jsxImportSource @opentui/react */
import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GLYPH_SET_KEY } from "../../src/state/glyph-set"
import { HelpDialog } from "../../src/tui-react/component/help-dialog"
import { act, renderComponent, waitForFrameText } from "./harness"

const originalHome = process.env.ROVE_HOME_DIR
afterEach(() => {
  if (originalHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = originalHome
})

function useGlyphPreset(name: string): void {
  const home = mkdtempSync(join(tmpdir(), "rove-help-marks-"))
  const configDir = join(home, ".config", "rove")
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, "state.json"), JSON.stringify({ [GLYPH_SET_KEY]: name }))
  process.env.ROVE_HOME_DIR = home
}

function rowWith(frame: string, text: string): string {
  return frame.split("\n").find((line) => line.includes(text)) ?? ""
}

describe("help dialog mark legend", () => {
  it("explains each mark in the glyph preset the user picked", async () => {
    useGlyphPreset("ascii")
    const { frame, mockInput } = await renderComponent(<HelpDialog />, {
      width: 100,
      height: 40,
      providers: { kv: true, dialog: true },
    })

    // Filter to the legend so it sits on screen instead of below the fold.
    act(() => mockInput.pressKey("/"))
    await act(async () => mockInput.typeText("exited"))
    const filtered = await waitForFrameText(frame, "MARKS — tab strip and Inbox")

    expect(rowWith(filtered, "the engine process exited")).toMatch(/^\s*x\s/)
    expect(rowWith(filtered, "needs you:")).toMatch(/^\s*!\s/)
    expect(filtered).not.toContain("MARKS — pull request chip")
  })
})
