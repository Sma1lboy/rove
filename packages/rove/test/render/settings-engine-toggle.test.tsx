/** @jsxImportSource @opentui/react */
/**
 * Settings → Engines: `space` switches the engine under the cursor off, so it
 * stops being offered when picking an engine for a task. Driven with the real
 * chord through the real dialog — a binding that never registers is the
 * failure mode a snapshot of the row list would miss.
 */

import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { useKV } from "../../src/tui-react/context/kv"
import { act, renderComponent, settle } from "./harness"

const NOOP = (): void => {}

function Driver() {
  const kv = useKV()
  return <SettingsDialog kv={kv} onClose={NOOP} />
}

test("space switches the focused engine off and back on", async () => {
  process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-engine-toggle-"))
  const { frame, mockInput } = await renderComponent(<Driver />, {
    width: 110,
    height: 40,
    providers: { kv: true, dialog: true },
  })
  const press = async (key: string): Promise<string> => {
    act(() => mockInput.pressKey(key))
    await settle()
    return await frame()
  }

  await press("j") // sidebar: General → Engines
  await press("l") // into the engine list
  const enabled = await press("j") // second engine (leave the default alone)
  expect(enabled).not.toContain("[ ]")

  // A literal space — "space" as a key NAME would type those five letters.
  expect(await press(" ")).toContain("[ ]")
  expect(await press(" ")).not.toContain("[ ]")
})

test("clicking the checkbox toggles it instead of opening the command editor", async () => {
  process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-engine-click-"))
  const { frame, mockInput, mockMouse } = await renderComponent(<Driver />, {
    width: 110,
    height: 40,
    providers: { kv: true, dialog: true },
  })
  act(() => mockInput.pressKey("j")) // → Engines
  await settle()

  // Locate a real checkbox on screen rather than hard-coding a cell — the
  // section hint mentions "[x]" too, so anchor on an engine row.
  const lines = (await frame()).split("\n")
  const y = lines.findIndex((line) => line.includes("[x]") && line.includes("Codex"))
  expect(y).toBeGreaterThan(-1)
  const x = (lines[y] as string).indexOf("[x]") + 1 // the "x" cell itself

  await act(async () => {
    await mockMouse.click(x, y)
  })
  await settle()

  const after = await frame()
  // Clicking the ROW opens the launch-command editor; the checkbox must not.
  expect(after).not.toContain("Codex launch command")
  expect(after.split("\n")[y] as string).toContain("[ ]")
})
