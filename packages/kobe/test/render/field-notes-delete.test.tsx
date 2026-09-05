/** @jsxImportSource @opentui/react */
/**
 * Retiring a field note from the reader dialog.
 *
 * The store's newest 15 notes are injected into every fresh session on the
 * repo, so a note whose fact stopped being true is not inert — later agents
 * act on it. Until this the only correction was hand-editing the daemon's
 * JSON: the dialog scrolled, the CLI appended, and neither could remove.
 *
 * `d` is a PROPOSED chord pending owner sign-off; the binding is what these
 * press, because a row drawn with a cursor whose key was never registered
 * renders identically to one that works.
 */

import { expect, test } from "bun:test"
import type { StoredFieldNote } from "../../src/state/field-notes"
import { FieldNotesDialogView } from "../../src/tui-react/component/field-notes-dialog"
import { act, renderComponent, settle } from "./harness"

const NOTES: readonly StoredFieldNote[] = [
  { id: 2, at: "2026-08-20T10:00:00.000Z", text: "tests must run under bun", taskId: "t2", author: "worker-b" },
  { id: 1, at: "2026-08-19T10:00:00.000Z", text: "the daemon needs a restart", taskId: "t1", author: "worker-a" },
]

function view(opts: { remove?: (id: number) => Promise<boolean> }) {
  return (
    <FieldNotesDialogView
      repo="/repo/x"
      load={() => Promise.resolve(NOTES)}
      {...(opts.remove ? { remove: opts.remove } : {})}
      onClose={() => {}}
    />
  )
}

test("`d` retires the note under the cursor, by ID and not by position", async () => {
  // Position identifies nothing: notes are prepended and evicted from the
  // tail, so a delete keyed on an index would remove whatever had shifted
  // into that slot.
  const removed: number[] = []
  const { frame, mockInput } = await renderComponent(
    view({
      remove: async (id) => {
        removed.push(id)
        return true
      },
    }),
    { width: 100, height: 30, providers: { dialog: true } },
  )
  await act(async () => {})
  expect(await frame()).toContain("tests must run under bun")

  // Cursor starts on the newest note; step to the older one and delete it.
  act(() => mockInput.pressArrow("down"))
  act(() => mockInput.pressKey("d"))
  await settle()
  // The confirm names the fact being retired. It is a DANGER confirm, so it
  // opens focused on Cancel — accepting means stepping to Confirm first.
  expect(await frame()).toContain("Delete this field note?")
  act(() => mockInput.pressArrow("left"))
  act(() => mockInput.pressEnter())
  await settle()

  expect(removed).toEqual([1])
  // The list repaints from what the store just confirmed rather than
  // refetching — a second round-trip would blank the dialog.
  const after = await frame()
  expect(after).toContain("tests must run under bun")
  expect(after).not.toContain("the daemon needs a restart")
})

test("without a remove handler the dialog stays the read-only reader it was", async () => {
  // The footer is the affordance, and `d` must not be bound where there is
  // nowhere for the delete to go (mocks, an offline host).
  const { frame, mockInput } = await renderComponent(view({}), {
    width: 100,
    height: 30,
    providers: { dialog: true },
  })
  await act(async () => {})
  expect(await frame()).toContain("↑↓ scroll · esc close")

  act(() => mockInput.pressKey("d"))
  await settle()
  expect(await frame()).not.toContain("Delete this field note?")
})

test("declining the confirm keeps the note — the danger confirm opens on Cancel", async () => {
  const removed: number[] = []
  const { frame, mockInput } = await renderComponent(
    view({
      remove: async (id) => {
        removed.push(id)
        return true
      },
    }),
    { width: 100, height: 30, providers: { dialog: true } },
  )
  await act(async () => {})
  act(() => mockInput.pressKey("d"))
  await settle()
  // Enter without stepping = Cancel, which is the whole point of the danger
  // default: a reflex keypress must not destroy a note.
  act(() => mockInput.pressEnter())
  await settle()

  expect(removed).toEqual([])
  expect(await frame()).toContain("tests must run under bun")
})
