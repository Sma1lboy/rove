/** @jsxImportSource @opentui/react */
/**
 * Settings → Keybindings used to print a YAML example and leave you to create
 * the file yourself. The page now writes it: one keypress, and the section
 * flips from "not created yet" to a real config it can report on.
 */

import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { useKV } from "../../src/tui-react/context/kv"
import { act, renderComponent, settle } from "./harness"

const NOOP = (): void => {}

function Driver() {
  const kv = useKV()
  return <SettingsDialog kv={kv} standalone onClose={NOOP} />
}

test("the Keybindings page writes the starter YAML on enter", async () => {
  const home = mkdtempSync(join(tmpdir(), "kobe-keys-create-"))
  process.env.KOBE_HOME_DIR = home
  const yaml = join(home, ".rove", "settings", "keybindings.yaml")
  expect(existsSync(yaml)).toBe(false)

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

  for (let i = 0; i < 3; i++) await press("j") // → Keybindings
  expect(await frame()).toContain("not created yet")

  await press("l") // into the body — prefix presentation rows come first
  await press("j")
  await press("j") // → Create keybindings.yaml
  // `pressEnter()`, not `pressKey("return")`: the mock's key NAMES are
  // uppercase, so a lowercase one is typed as its six letters.
  act(() => mockInput.pressEnter())
  await settle()
  const after = await frame()

  expect(existsSync(yaml)).toBe(true)
  // Commented out end to end: creating the file must not rebind anything.
  const written = readFileSync(yaml, "utf8")
  expect(written.split("\n").filter((l) => l.trim() && !l.trimStart().startsWith("#"))).toEqual([])
  // The offer is gone and the section now reports on a real file.
  expect(after).not.toContain("not created yet")
  expect(after).not.toContain("Create keybindings.yaml")
})
