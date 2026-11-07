/** @jsxImportSource @opentui/react */
/**
 * General → Updates: the channel row persists the preference `rove update` and the update check read, and the
 * notify checkbox persists the one that gates the update chip.
 */

import { expect, it } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { UPDATE_CHANNEL_KEY, UPDATE_NOTIFY_KEY } from "../../src/state/update-channel"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { useKV } from "../../src/tui-react/context/kv"
import { generalRows, rowIndex } from "../../src/tui/component/settings-dialog/model"
import { act, renderComponent, settle } from "./harness"

function Driver() {
  return <SettingsDialog kv={useKV()} onClose={() => {}} />
}

it("enter on Update channel walks stable → next → nightly, and the notify checkbox persists", async () => {
  const home = mkdtempSync(join(tmpdir(), "rove-update-channel-"))
  process.env.ROVE_HOME_DIR = home
  const { frame, mockInput } = await renderComponent(<Driver />, {
    width: 110,
    height: 90,
    providers: { kv: true, dialog: true },
  })
  const press = async (key: string): Promise<string> => {
    act(() => (key === "return" ? mockInput.pressEnter() : mockInput.pressKey(key)))
    await settle()
    return await frame()
  }
  const persisted = () => JSON.parse(readFileSync(join(home, ".config", "rove", "state.json"), "utf8"))

  const text = await press("l")
  // A stable build, never switched: follows stable, notifies.
  expect(text).toContain("Channel: stable  ")
  expect(text).toContain("[x] Notify on updates")
  for (let i = 0; i < rowIndex(generalRows(), "update-channel"); i++) await press("j")

  await press("return")
  await settle(320)
  expect(await frame()).toContain("Channel: next preview  ")
  expect(persisted()[UPDATE_CHANNEL_KEY]).toBe("next")

  await press("return")
  await settle(320)
  expect(await frame()).toContain("Channel: nightly preview  ")
  expect(persisted()[UPDATE_CHANNEL_KEY]).toBe("nightly")

  await press("return")
  await settle(320)
  expect(await frame()).toContain("Channel: stable  ")
  expect(persisted()[UPDATE_CHANNEL_KEY]).toBe("latest")

  await press("j")
  await press("return")
  await settle(320)
  expect(await frame()).toContain("[ ] Notify on updates")
  expect(persisted()[UPDATE_NOTIFY_KEY]).toBe(false)
})
