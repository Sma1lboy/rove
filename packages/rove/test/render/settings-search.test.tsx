/** @jsxImportSource @opentui/react */
import { afterAll, expect, it } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { useKV } from "../../src/tui-react/context/kv"
import { act, renderComponent, waitForFrameText } from "./harness"

const savedHome = process.env.ROVE_HOME_DIR
afterAll(() => {
  if (savedHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = savedHome
})

it("/ finds a setting in another section and enter lands on it, ready to activate", async () => {
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-settings-search-"))
  let closed = 0
  function Driver() {
    return <SettingsDialog kv={useKV()} initialSection="dev" onClose={() => closed++} />
  }
  const r = await renderComponent(<Driver />, { width: 110, height: 40, providers: { kv: true, dialog: true } })
  const press = async (key: () => void) => {
    act(key)
    await r.frame()
  }
  const enter = () => r.mockInput.pressEnter()
  const type = async (text: string) => {
    await act(async () => {
      await r.mockInput.typeText(text)
    })
    return r.frame()
  }

  await press(() => r.mockInput.pressKey("/"))
  // `q` is typed into the field, not taken as close.
  expect(await type("qzx")).toContain("No setting matches.")
  expect(closed).toBe(0)
  await act(async () => {
    await r.mockInput.pressKeys(["\b", "\b", "\b"])
  })
  const results = await type("scroll")
  expect(results).toContain("Scrollback rows")
  expect(results).toContain("· General › Terminal")

  // Enter puts the cursor on the General row; a second enter opens its editor.
  await press(enter)
  expect(await r.frame()).toContain("scrollback:")
  await press(enter)
  expect(await r.frame()).toContain("Terminal scrollback rows")
  expect(closed).toBe(0)
})

it("esc leaves the search without closing Settings", async () => {
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-settings-search-esc-"))
  let closed = 0
  function Driver() {
    return <SettingsDialog kv={useKV()} onClose={() => closed++} />
  }
  const r = await renderComponent(<Driver />, { width: 110, height: 40, providers: { kv: true, dialog: true } })
  act(() => r.mockInput.pressKey("/"))
  expect(await r.frame()).toContain("Search settings")
  // A lone ESC resolves only after opentui's escape-sequence window.
  act(() => r.mockInput.pressEscape())
  expect(await waitForFrameText(async () => r.frame(), "/ search")).toContain("j/k pick")
  expect(closed).toBe(0)
})
