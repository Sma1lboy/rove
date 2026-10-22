/** @jsxImportSource @opentui/react */
/**
 * Settings → Engines: `space` switches the engine under the cursor off, so it
 * stops being offered when picking an engine for a task. Driven with the real
 * chord through the real dialog — a binding that never registers is the
 * failure mode a snapshot of the row list would miss.
 */

import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { useKV } from "../../src/tui-react/context/kv"
import { act, renderComponent, settle } from "./harness"

const NOOP = (): void => {}

/** The on/off mark on an engine's row: the line naming it with a status dot. */
function markOf(frame: string, name: string): string | undefined {
  const line = frame.split("\n").find((l) => l.includes(name) && l.includes("●"))
  return line?.match(/\b(available|off)\b/)?.[1]
}

function Driver() {
  const kv = useKV()
  return <SettingsDialog kv={kv} onClose={NOOP} />
}

test("space switches the focused engine off and back on", async () => {
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-engine-toggle-"))
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
  expect(markOf(enabled, "Codex")).toBe("available")

  // A literal space — "space" as a key NAME would type those five letters.
  expect(markOf(await press(" "), "Codex")).toBe("off")
  expect(markOf(await press(" "), "Codex")).toBe("available")
})

test("clicking the available mark toggles it instead of opening the command editor", async () => {
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-engine-click-"))
  const { frame, mockInput, mockMouse } = await renderComponent(<Driver />, {
    width: 110,
    height: 40,
    providers: { kv: true, dialog: true },
  })
  act(() => mockInput.pressKey("j")) // → Engines
  await settle()

  // Locate the real mark on screen rather than hard-coding a cell.
  const lines = (await frame()).split("\n")
  const y = lines.findIndex((line) => line.includes("Codex") && line.includes("●"))
  expect(y).toBeGreaterThan(-1)
  const x = (lines[y] as string).indexOf("available") + 2

  await act(async () => {
    await mockMouse.click(x, y)
  })
  await settle()

  const after = await frame()
  // Clicking the ROW opens the launch-command editor; the mark must not.
  expect(after).not.toContain("Codex launch command")
  expect(markOf(after, "Codex")).toBe("off")
})

test("one line per engine; a renamed engine keeps its registry name as a subtitle", async () => {
  const home = mkdtempSync(join(tmpdir(), "rove-engine-rename-"))
  const configDir = join(home, ".config", "rove")
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    join(configDir, "state.json"),
    JSON.stringify({
      "engineName.codex": "Work Codex",
      customEngineIds: ["aider"],
      "engineName.aider": "Aider",
      "engineCommand.aider": "aider-not-on-this-machine --model sonnet",
      disabledEngineIds: ["aider"],
    }),
  )
  process.env.ROVE_HOME_DIR = home
  const { frame, mockInput } = await renderComponent(<Driver />, {
    width: 110,
    height: 44,
    providers: { kv: true, dialog: true },
  })
  const press = async (key: string): Promise<string> => {
    act(() => mockInput.pressKey(key))
    await settle()
    return await frame()
  }
  await press("j") // → Engines
  await press("l") // into the list (Claude)
  let text = await press("j") // Work Codex
  for (let i = 0; i < 50 && text.includes("Checking"); i++) {
    await settle()
    text = await frame()
  }
  if (process.env.ROVE_PRINT_FRAME) console.log(text)

  const lines = text.split("\n")
  const codexRow = lines.find((l) => l.includes("Work Codex") && l.includes("●")) ?? ""
  expect(codexRow).toContain("(Codex)")
  expect(markOf(text, "Work Codex")).toBe("available")
  // A custom engine says so, and a command that points nowhere is "Not on PATH", switched off.
  const aiderRow = lines.find((l) => l.includes("Aider") && l.includes("●")) ?? ""
  expect(aiderRow).toContain("(custom)")
  expect(aiderRow).toContain("Not on PATH")
  expect(markOf(text, "Aider")).toBe("off")
  // The details follow the cursor: Work Codex's facts, its default command.
  expect(text).toMatch(/Command\s+codex/)
  expect(text).toContain("Engine integrations")
})
