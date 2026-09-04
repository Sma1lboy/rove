/** @jsxImportSource @opentui/react */
/**
 * Field-notes reader (`component/field-notes-dialog.tsx`) against the
 * mounted view. Three states matter and each fails silently if wrong: an
 * empty repo must show the empty MESSAGE (a blank card looks like a load
 * that never finished), a filled list must show each note's provenance
 * (author + time — the point of the reader), and a rejected load must
 * surface its error rather than sit on "Loading…" forever.
 */

import { describe, expect, test } from "bun:test"
import type { StoredFieldNote } from "../../src/state/field-notes"
import { FieldNotesDialogView } from "../../src/tui-react/component/field-notes-dialog"
import { renderComponent, settle } from "./harness"

function mount(load: () => Promise<readonly StoredFieldNote[]>) {
  return renderComponent(<FieldNotesDialogView repo="/repos/rove" load={load} onClose={() => {}} />, {
    providers: { dialog: true },
    width: 90,
    height: 24,
  })
}

describe("FieldNotesDialogView", () => {
  test("a repo with no notes renders the empty message, not a blank box", async () => {
    const { frame } = await mount(async () => [])
    await settle()
    const f = await frame()
    expect(f).toContain("Field notes")
    expect(f).toContain("/repos/rove")
    expect(f).toContain("No field notes for this repo yet")
    expect(f).not.toContain("Loading")
  })

  test("each note shows its text, author and time, newest first", async () => {
    const notes: StoredFieldNote[] = [
      { at: "2026-09-01T10:30:00.000Z", text: "the gotcha", taskId: "t1", author: "fix-the-pty" },
      { at: "2026-08-30T08:00:00.000Z", text: "older lesson", taskId: "t2", author: "seed-branch" },
    ]
    const { frame } = await mount(async () => notes)
    await settle()
    const f = await frame()
    expect(f).toContain("the gotcha")
    expect(f).toContain("fix-the-pty")
    expect(f).toContain("older lesson")
    expect(f).toContain("seed-branch")
    // Provenance line precedes its note body, and the newer note comes first.
    expect(f.indexOf("fix-the-pty")).toBeLessThan(f.indexOf("the gotcha"))
    expect(f.indexOf("the gotcha")).toBeLessThan(f.indexOf("older lesson"))
    // The time is rendered to the minute in local time — assert the shape,
    // not the zone-dependent digits.
    expect(f).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} · fix-the-pty/)
  })

  test("a failed load shows the error instead of staying on Loading", async () => {
    const { frame } = await mount(async () => {
      throw new Error("daemon unreachable")
    })
    await settle()
    const f = await frame()
    expect(f).toContain("daemon unreachable")
    expect(f).not.toContain("Loading")
  })
})
