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
