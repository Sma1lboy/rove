/** @jsxImportSource @opentui/react */
/**
 * The drawer's STATUS field — the human's only route out of a Kanban column.
 *
 * The board itself is read-only (its keys steer the cursor) and `d` deletes,
 * so before this field "I finished this" and "this never existed" were the
 * same gesture. The field rides the drawer's EXISTING tab cycle rather than a
 * new board chord, which is what this pins: tabbing has to REACH it, ←/→ has
 * to step it, and the outcome has to carry the chosen status out — a chip row
 * drawn without its bindings looks identical to one that works.
 */

import { expect, test } from "bun:test"
import type { ReactNode } from "react"
import type { Issue } from "@sma1lboy/kobe-daemon/daemon/issues-store"
import { IssueDetailDialogView, type IssueDetailOutcome } from "../../src/tui-react/component/issue-detail-dialog"
import { act, renderComponent, settle } from "./harness"

/** Unlinked and not done: the drawer's `startable` shape, whose cycle is
 *  title → description → status → engine → workspace → jump. */
const OPEN_ISSUE: Issue = {
  id: 4,
  title: "Drop the retry loop",
  status: "open" as const,
  created: "2026-08-20",
  body: "It masks the real failure.",
}

const DONE_ISSUE: Issue = { ...OPEN_ISSUE, id: 5, status: "done" }

function drawer(issue: Issue, onSubmit: (outcome: IssueDetailOutcome) => void): ReactNode {
  return (
    <IssueDetailDialogView
      issue={issue}
      engines={["claude"]}
      defaultVendor="claude"
      engineLabel={() => "Claude"}
      orchestrator={null}
      onSubmit={onSubmit}
      onCancel={() => {}}
    />
  )
}

test("tab reaches STATUS and ←/→ steps it, and esc carries the choice out", async () => {
  const outcomes: IssueDetailOutcome[] = []
  const { frame, mockInput } = await renderComponent(
    drawer(OPEN_ISSUE, (o) => outcomes.push(o)),
    {
      width: 120,
      height: 60,
      providers: { dialog: true },
    },
  )
  expect(await frame()).toContain("STATUS")

  // Focus opens on WORKSPACE for a startable story; tab wraps through
  // jump → title → description → status. Pressing the keys rather than
  // reading the frame is the point: an unregistered binding renders the same.
  for (let i = 0; i < 4; i++) act(() => mockInput.pressTab())
  act(() => mockInput.pressArrow("right"))
  act(() => mockInput.pressArrow("right"))

  // open → doing → hold, and the header badge follows the DRAFT so the user
  // can see the step landed.
  expect(await frame()).toContain("hold")

  act(() => mockInput.pressEscape())
  await settle()
  expect(outcomes).toHaveLength(1)
  expect(outcomes[0]).toMatchObject({ kind: "close", status: "hold" })
})

test("a DONE story can be sent back — the one card the drawer could not act on", async () => {
  // Done + unlinked is the drawer's narrowest shape: nothing to start, no
  // session to open. It used to offer only "esc save & close", which is how a
  // finished card became unreopenable without an agent running issue-set-status.
  const outcomes: IssueDetailOutcome[] = []
  const { mockInput } = await renderComponent(
    drawer(DONE_ISSUE, (o) => outcomes.push(o)),
    {
      width: 120,
      height: 60,
      providers: { dialog: true },
    },
  )

  // Cycle is title → description → status; focus opens on title.
  act(() => mockInput.pressTab())
  act(() => mockInput.pressTab())
  // done is last in ISSUE_STATUSES, so one step right wraps to open.
  act(() => mockInput.pressArrow("right"))
  act(() => mockInput.pressEscape())
  await settle()

  expect(outcomes[0]).toMatchObject({ kind: "close", status: "open" })
})

test("an untouched drawer reports the status it opened with, so nothing is written back", async () => {
  // The page compares against the open-time snapshot and only writes a
  // CHANGED status. Reporting anything else here would make every close race
  // an agent's `issue-set-status` and revert it.
  const outcomes: IssueDetailOutcome[] = []
  const { mockInput } = await renderComponent(
    drawer(OPEN_ISSUE, (o) => outcomes.push(o)),
    {
      width: 120,
      height: 60,
      providers: { dialog: true },
    },
  )
  act(() => mockInput.pressEscape())
  await settle()
  expect(outcomes[0]).toMatchObject({ kind: "close", status: "open" })
})
