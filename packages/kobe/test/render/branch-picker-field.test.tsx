/** @jsxImportSource @opentui/react */
/**
 * The set-branch dialog's one input must be built from the shared dialog
 * parts. It already borrows `PickerList` for its rows, so the label and the
 * input were the only pieces left speaking a private dialect: a thin `accent`
 * label and a bare input with no well around it, next to a rename dialog
 * whose single labelled input looks nothing like it.
 */

import { expect, test } from "bun:test"
import { TextAttributes } from "@opentui/core"
import { BranchPickerDialogView } from "../../src/tui-react/component/branch-picker-dialog"
import { BUNDLED_THEMES, DEFAULT_THEME, applyDisplayOverlay, resolveTheme } from "../../src/tui/context/theme-core"
import { renderComponent } from "./harness"

const theme = applyDisplayOverlay(resolveTheme(BUNDLED_THEMES[DEFAULT_THEME], "dark"), "primary", true)

test("the branch field wears the shared dialog label and well", async () => {
  const { frame, spans } = await renderComponent(
    <BranchPickerDialogView currentBranch="feat/a" repo="/x/kobe" onSubmit={() => {}} onCancel={() => {}} />,
    // 34+ rows: below that `FRAMED_DIALOG_MIN_ROWS` drops every well in the
    // dialog system, this one included.
    { width: 70, height: 36, providers: { dialog: true } },
  )
  const label = (await spans()).lines.flatMap((line) => line.spans).find((span) => span.text.trim() === "branch")
  expect(label).toBeDefined()
  // A focused DialogLabel: primary, BOLD *and* UNDERLINE. `accent` + plain
  // BOLD is what this file used to draw.
  expect(label?.fg?.toInts()).toEqual(theme.primary.toInts())
  expect((label?.attributes ?? 0) & TextAttributes.UNDERLINE).toBe(TextAttributes.UNDERLINE)
  // The well: DialogField's rounded border around the input.
  expect(await frame()).toContain("╭")
})
