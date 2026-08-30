/** @jsxImportSource @opentui/react */
/**
 * Settings must stay usable at the width `docs/TUI.md` promises (46 columns,
 * phone SSH). The row math lives in `generalLabelLayout`; this mounts the
 * REAL dialog to prove it is actually wired to the live terminal width —
 * a correct helper nobody calls renders exactly like the bug.
 *
 * The visible symptom was a label padded to 30 cells inside a 26-cell row:
 * `Row` is `overflow="hidden"` + `wrapMode="none"`, so the label was cut with
 * no ellipsis and the hint beside it never appeared at all.
 */

import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SettingsDialog } from "../../src/tui-react/component/settings-dialog"
import { useKV } from "../../src/tui-react/context/kv"
import { renderComponent } from "./harness"

function Driver() {
  const kv = useKV()
  return <SettingsDialog kv={kv} onClose={() => {}} />
}

async function generalAt(width: number): Promise<string> {
  process.env.KOBE_HOME_DIR = mkdtempSync(join(tmpdir(), "kobe-narrow-"))
  const { frame } = await renderComponent(<Driver />, { width, height: 42, providers: { kv: true, dialog: true } })
  return await frame()
}

test("at 46 columns the label renders whole instead of being cut mid-word", async () => {
  const text = await generalAt(46)
  // The longest General label, previously clipped by its own padding.
  expect(text).toContain("Show keyboard hints")
  // Its inline hint is dropped rather than rendered as a clipped fragment.
  expect(text).not.toContain("re-enabling relights")
})

test("a desktop width still shows label and hint side by side", async () => {
  const text = await generalAt(110)
  expect(text).toContain("Show keyboard hints")
  expect(text).toContain("re-enabling relights hints dismissed by use")
})
