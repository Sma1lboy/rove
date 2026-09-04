/**
 * Every choose-one field in a dialog is a `ChipRow` (ui/dialog-parts). A
 * component that hand-rolls a `▸ `-marked `<text>` per choice is the exact
 * drift this guards: three dialogs had grown their own selector before the
 * shared one existed, and each looked different from the others.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = join(__dirname, "../../src/tui-react")
const DIALOG_FILES = [
  ...readdirSync(join(ROOT, "component")).filter((f) => /dialog|composer/.test(f) && f.endsWith(".tsx")),
  ...readdirSync(join(ROOT, "component/new-task-dialog")).map((f) => `new-task-dialog/${f}`),
].filter((f) => f.endsWith(".tsx") && !f.endsWith("/picker-list.tsx"))

/**
 * A vertical LIST inside a `DialogField` well, cursor-driven with ↑/↓, is a
 * different control from a chip row: the story drawer's WORKSPACE placements
 * are whole sentences, which chips would stack three rows tall apiece.
 */
const LIST_IN_WELL = new Set(["issue-detail-dialog.tsx"])

describe("dialog choose-one grammar", () => {
  it.each(DIALOG_FILES.filter((f) => !LIST_IN_WELL.has(f)))("%s renders no hand-rolled ▸ selector", (file) => {
    const src = readFileSync(join(ROOT, "component", file), "utf8")
    expect(src.includes('"▸ " : "  "'), `${file}: use <ChipRow> for a choose-one field`).toBe(false)
  })
})
