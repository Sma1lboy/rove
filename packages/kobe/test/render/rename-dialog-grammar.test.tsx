/** @jsxImportSource @opentui/react */
/**
 * The rename prompt (`component/rename-task-dialog.tsx`) wearing the house
 * dialog grammar — `docs/design/dialogs.md`.
 *
 * It is the most REUSED dialog in the app: ~10 call sites hand it a label and
 * a submit verb (tab titles, split names, engine id/command/protocol, the
 * scrollback and worktree-base settings). That is exactly why its chrome is
 * worth pinning — a dialog reached from ten places is the one most likely to
 * be re-drawn by hand at the eleventh, and the frame it draws is the only
 * thing on screen saying "this is a field, and it is the one you are typing
 * into".
 */

import { expect, test } from "bun:test"
import { RenameTaskDialogView } from "../../src/tui-react/component/rename-task-dialog"
import { type RenderHandle, act, renderComponent } from "./harness"

function mount(props: Partial<Parameters<typeof RenameTaskDialogView>[0]> = {}): {
  handle: Promise<RenderHandle>
  submitted: string[]
} {
  const submitted: string[] = []
  return {
    handle: renderComponent(
      <RenameTaskDialogView
        currentTitle="Visual Fixture"
        onSubmit={(v) => submitted.push(v)}
        onCancel={() => {}}
        {...props}
      />,
      { width: 80, height: 40, providers: { dialog: true } },
    ),
    submitted,
  }
}

test("the field sits in a rounded well under a capitalised label, over a key legend", async () => {
  const { frame } = await mount().handle
  const text = await frame()
  expect(text).toContain("Rename task")
  expect(text).toContain("esc") // the header's dismiss affordance
  expect(text).toContain("TITLE") // DialogLabel, not the old lowercase "title"
  // DialogField spreads FRAME, so the well is ROUNDED — square corners here
  // were the whole complaint that produced docs/design/dialogs.md.
  expect(text).toContain("╭")
  expect(text).toContain("╰")
  expect(text).not.toContain("┌")
  expect(text).not.toContain("└")
  expect(text).toContain("enter rename") // DialogFooter
})

test("a caller's own label rides the same grammar", async () => {
  // Every override reaches DialogLabel unchanged, so the CAPS convention is
  // the CALLER's to keep — this pins that the dialog does not re-case it.
  const { frame } = await mount({ dialogTitle: "Add engine · x — protocol", fieldLabel: "PROTOCOL" }).handle
  const text = await frame()
  expect(text).toContain("PROTOCOL")
  expect(text).toContain("Add engine")
})

test("enter still commits the edited value through the framed field", async () => {
  const { handle, submitted } = mount()
  const { frame, mockInput } = await handle
  await frame()
  act(() => mockInput.pressEnter())
  await frame()
  expect(submitted).toEqual(["Visual Fixture"])
})

test("a blank title is refused — the well is chrome, not a bypass", async () => {
  const { handle, submitted } = mount({ currentTitle: "   " })
  const { frame, mockInput } = await handle
  await frame()
  act(() => mockInput.pressEnter())
  await frame()
  expect(submitted).toEqual([])
})
