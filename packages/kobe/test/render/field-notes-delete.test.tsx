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
import { useEffect, useRef } from "react"
import type { StoredFieldNote } from "../../src/state/field-notes"
import { FieldNotesDialog, FieldNotesDialogView } from "../../src/tui-react/component/field-notes-dialog"
import { useDialog } from "../../src/tui-react/ui/dialog"
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
  // What this mount can prove ends here: the id. Mounted directly, the view
  // is not a stack entry, so the confirm never displaced it and it never
  // re-ran `load` — the REPAINT after a delete is the last test in this file,
  // through the real `show`.
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

/**
 * The three cases above mount the VIEW directly, so nothing of theirs ever
 * sits on the dialog stack — which is precisely why they stayed green while
 * the shipped dialog did not work. `showDialog` REPLACES by default: a
 * confirm opened from the reader ran every stack entry's `onClose`, resolving
 * the reader's own promise and unmounting it. The note was deleted and the
 * reader vanished with it, so the delete could never be seen to have worked.
 *
 * This one goes through `FieldNotesDialog.show` — the real entry point — so
 * the reader is a stack entry and a replacing confirm can destroy it.
 */
test("confirming a delete leaves the reader open — the confirm stacks, it does not replace", async () => {
  let store: readonly StoredFieldNote[] = NOTES
  function Opener(props: { onDelete: (id: number) => void }) {
    const dialog = useDialog()
    // Open exactly once. The dialog context's identity intentionally follows
    // stack transitions, so an effect that depends on it re-runs on every
    // push and pop — and this one reopens the reader, which pushes again.
    const opened = useRef(false)
    useEffect(() => {
      if (opened.current) return
      opened.current = true
      FieldNotesDialog.show(dialog, {
        repo: "/repo/x",
        orchestrator: {
          // A LIVE store, not a constant: popping the confirm remounts the
          // reader, which re-runs `load`. A frozen list would redraw the note
          // the delete just removed and the test would still call that a pass.
          listFieldNotes: async () => store,
          deleteFieldNote: async (_repo, id) => {
            props.onDelete(id)
            store = store.filter((n) => n.id !== id)
            return true
          },
        },
      })
    }, [dialog, props.onDelete])
    return null
  }

  const removed: number[] = []
  const { frame, mockInput } = await renderComponent(<Opener onDelete={(id) => removed.push(id)} />, {
    width: 100,
    height: 30,
    providers: { dialog: true },
  })
  await settle()
  expect(await frame()).toContain("tests must run under bun")

  act(() => mockInput.pressKey("d"))
  await settle()
  expect(await frame()).toContain("Delete this field note?")

  // Step off the danger default and commit.
  act(() => mockInput.pressArrow("left"))
  act(() => mockInput.pressEnter())
  await settle()
  // The reopen is chained off the store call, so poll rather than guessing a
  // single settle window.
  for (let i = 0; i < 40; i++) {
    if (!(await frame()).includes("tests must run under bun")) break
    await settle(25)
  }

  expect(removed).toEqual([2])
  const after = await frame()
  // The confirm is gone and the reader is back — not blank, not closed.
  expect(after).not.toContain("Delete this field note?")
  expect(after).toContain("Field notes")
  expect(after).toContain("the daemon needs a restart")
  expect(after).not.toContain("tests must run under bun")
})
