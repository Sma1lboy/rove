/** @jsxImportSource @opentui/react */
import { expect, it } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { useKV } from "../../src/tui-react/context/kv"
import { act, renderComponent, settle } from "./harness"

it("q closes Settings from the nav, but is a letter in the Feedback form", async () => {
  const previousHome = process.env.ROVE_HOME_DIR ?? ""
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-settings-q-"))
  let closed = 0
  function Driver() {
    return <SettingsDialog kv={useKV()} onClose={() => closed++} />
  }
  try {
    const r = await renderComponent(<Driver />, { width: 110, height: 40, providers: { kv: true, dialog: true } })
    const press = async (key: string) =>
      act(async () => {
        r.mockInput.pressKey(key)
        await settle()
      })
    await press("q")
    expect(closed).toBe(1)

    // Feedback is the last section: two up from the top wraps into it.
    await press("k")
    await press("k")
    await press("l")
    await act(async () => {
      await r.mockInput.typeText("quiq")
      await settle()
    })
    expect(closed).toBe(1)
    expect(await r.frame()).toContain("quiq")

    await act(async () => {
      r.mockInput.pressEscape()
      await settle()
    })
    expect(closed).toBe(2)
  } finally {
    process.env.ROVE_HOME_DIR = previousHome
  }
})
