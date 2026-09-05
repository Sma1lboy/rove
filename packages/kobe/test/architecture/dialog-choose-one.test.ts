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
 * Cursor-driven vertical lists — a different CONTROL from a chip row, so the
 * `▸` marker here is the list idiom (`worktrees-page.tsx` renders the same
 * one), not choose-one drift:
 *
 * - `issue-detail-dialog.tsx` — the story drawer's WORKSPACE placements are
 *   whole sentences, which chips would stack three rows tall apiece.
 * - `field-notes-dialog.tsx` — a scrollable list of RECORDS with a delete
 *   cursor, not a field with options. There is nothing to choose; `d` acts on
 *   the row under the cursor.
 */
const CURSOR_LISTS = new Set(["issue-detail-dialog.tsx", "field-notes-dialog.tsx"])

describe("dialog choose-one grammar", () => {
  it.each(DIALOG_FILES.filter((f) => !CURSOR_LISTS.has(f)))("%s renders no hand-rolled ▸ selector", (file) => {
    const src = readFileSync(join(ROOT, "component", file), "utf8")
    expect(src.includes('"▸ " : "  "'), `${file}: use <ChipRow> for a choose-one field`).toBe(false)
  })
})
