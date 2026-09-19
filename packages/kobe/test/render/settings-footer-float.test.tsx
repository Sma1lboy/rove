/** @jsxImportSource @opentui/react */
/**
 * The standalone Settings page scrolls its content; the nav hint must not
 * scroll with it. On a short terminal the General section is taller than the
 * viewport, so a hint living at the end of the content would be below the
 * fold — exactly when a section you can't fully see is what makes you want it.
 */

import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { useKV } from "../../src/tui-react/context/kv"
import { renderComponent } from "./harness"

const NOOP = (): void => {}

function Driver() {
  const kv = useKV()
  return <SettingsDialog kv={kv} onClose={NOOP} />
}

test("the nav hint stays visible on a short standalone page", async () => {
  process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-settings-footer-"))
  const { frame } = await renderComponent(<Driver />, {
    width: 100,
    height: 20,
    providers: { kv: true, dialog: true },
  })
  const text = await frame()
  // Any heading from the section body proves the content rendered; the
  // section is taller than 20 rows, so this is the one nearest the top.
  expect(text).toContain("Appearance")
  expect(text).toContain("j/k pick")
})
