/** @jsxImportSource @opentui/react */
/**
 * Settings → Keybindings needs no file to start from: the first saved change writes
 * `keybindings.yaml` from the commented starter, with that one entry live in it.
 */

import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { useKV } from "../../src/tui-react/context/kv"
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

test("the first saved binding creates keybindings.yaml from the starter", async () => {
  const home = mkdtempSync(join(tmpdir(), "rove-keys-create-"))
  process.env.ROVE_HOME_DIR = home
  // The report memoizes its path on first call and bun runs every render test in one
  // process: drop the cache once the env var is set, or the save lands in another test's home.
  reloadUserKeybindings()
  const yaml = join(home, ".rove", "settings", "keybindings.yaml")
  expect(existsSync(yaml)).toBe(false)

  const { frame, mockInput } = await renderComponent(<Driver />, {
    width: 110,
    height: 40,
    providers: { kv: true, dialog: true },
  })
  const press = async (key: string, mods?: { ctrl: boolean }): Promise<string> => {
    act(() => mockInput.pressKey(key, mods))
    return await frame()
  }

  await repeat(5, () => press("j")) // → Keybindings
  expect(await frame()).toContain("not created yet")
  await press("l")
  await press("j")
  await press("j") // past the two prefix-tap rows → Prefix key
  // `pressEnter()`: the mock's key names are uppercase, a lowercase one is typed as letters.
  act(() => mockInput.pressEnter())
  const after = await press("b", { ctrl: true })

  const written = readFileSync(yaml, "utf8")
  expect(written).toContain("# Rove keybindings")
  expect(written.split("\n").filter((l) => l.trim() && !l.trimStart().startsWith("#"))).toEqual([
    "prefix:",
    "  key: ctrl+b",
  ])
  expect(after).not.toContain("not created yet")
  expect(after).toContain("Command layer (ctrl+b)")
})
