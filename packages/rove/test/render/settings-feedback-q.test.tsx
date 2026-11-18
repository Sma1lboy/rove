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

it("q closes Settings from the nav, but is a letter in the Feedback form", async () => {
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-settings-q-"))
  let closed = 0
  function Driver() {
    return <SettingsDialog kv={useKV()} onClose={() => closed++} />
  }
  const r = await renderComponent(<Driver />, { width: 110, height: 40, providers: { kv: true, dialog: true } })
  const press = async (key: string) => {
    act(() => r.mockInput.pressKey(key))
    await r.frame()
  }
  await press("q")
  expect(closed).toBe(1)

  // Feedback is the last section: two up from the top wraps into it.
  await press("k")
  await press("k")
  await press("l")
  await act(async () => {
    await r.mockInput.typeText("quiq")
  })
  expect(closed).toBe(1)
  expect(await r.frame()).toContain("quiq")

  // A lone ESC resolves only after opentui's escape-sequence window.
  act(() => r.mockInput.pressEscape())
  expect(await waitForFrameText(async () => `closed=${closed}`, "closed=2")).toBe("closed=2")
})
