/** @jsxImportSource @opentui/react */
/** Settings → Keybindings edits a binding with real keys: enter, then the chord, lands in the YAML and on the row. */

import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { useKV } from "../../src/tui-react/context/kv"
import { findBinding } from "../../src/tui/context/keybindings"
import { reloadUserKeybindings } from "../../src/tui/context/keybindings-user"
import { act, renderComponent } from "./harness"

const NOOP = (): void => {}

// The live keymap is process-wide: hand later files the defaults, not this file's YAML.
const savedHome = process.env.ROVE_HOME_DIR
afterAll(() => {
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-keys-clean-"))
  reloadUserKeybindings()
  if (savedHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = savedHome
})

async function repeat(n: number, step: () => Promise<unknown>): Promise<void> {
  for (let i = 0; i < n; i++) await step()
}

function Driver() {
  const kv = useKV()
  return <SettingsDialog kv={kv} onClose={NOOP} />
}

test("recording a chord on a binding saves it, and backspace restores the default", async () => {
  const home = mkdtempSync(join(tmpdir(), "rove-keys-edit-"))
  process.env.ROVE_HOME_DIR = home
  // The report memoizes its path; see settings-keybindings-create.test.tsx.
  reloadUserKeybindings()
  const yaml = join(home, ".rove", "settings", "keybindings.yaml")

  const { frame, mockInput } = await renderComponent(<Driver />, {
    width: 110,
    height: 60,
    providers: { kv: true, dialog: true },
  })
  const press = async (key: string, mods?: { ctrl: boolean }): Promise<string> => {
    act(() => mockInput.pressKey(key, mods))
    return await frame()
  }

  await repeat(5, () => press("j")) // → Keybindings
  await press("l")
  // Two prefix-tap rows, the create row, then the bindings: the fourth is "New task".
  await repeat(5, () => press("j"))
  act(() => mockInput.pressEnter())
  expect(await frame()).toContain("press the new key")

  // The recorder takes the key: `j` would otherwise move the cursor.
  const saved = await press("g", { ctrl: true })
  expect(readFileSync(yaml, "utf8")).toContain("task.new.global: ctrl+g")
  expect(findBinding("task.new.global")?.keys).toEqual(["ctrl+g"])
  expect(saved).toContain("default: ctrl+a n")

  act(() => mockInput.pressBackspace())
  expect(readFileSync(yaml, "utf8")).not.toContain("task.new.global")
  expect(findBinding("task.new.global")?.keys).toEqual([])
})
