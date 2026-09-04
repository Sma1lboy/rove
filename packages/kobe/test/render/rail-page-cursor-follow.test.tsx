/** @jsxImportSource @opentui/react */
/**
 * A rail page's cursor must stay on screen, and `enter` on Routines must open
 * the LATEST run's task.
 *
 * Both are invisible failures: the cursor keeps moving and the page keeps
 * painting, so nothing errors — the selected row is simply not in the frame,
 * and `enter` opens a task from some older run. Routines is the page asserted
 * here because its rows are uniform enough to name in a frame; the other three
 * pages share the same `useCursorFollow` mechanism and are photographed
 * through `/harness`.
 */

import { expect, test } from "bun:test"
import { createStateCell } from "../../src/lib/external-store"
import { AutomationsPage } from "../../src/tui-react/component/automations-page"
import { KanbanPage } from "../../src/tui-react/component/kanban-page"
import { renderComponent, settle } from "./harness"

const ONLINE = createStateCell("online")
const REPO = "/x/rove"

function routine(index: number) {
  return {
    id: `a${index}`,
    name: `routine-${String(index).padStart(2, "0")}`,
    repo: REPO,
    prompt: `prompt ${index}`,
    schedule: "0 9 * * *",
    enabled: true,
    nextRunAt: new Date(Date.now() + 3_600_000).toISOString(),
    missedRunGraceMinutes: 60,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  }
}

/** `automationRuns` answers newest-first, exactly as `runsFor` does. */
function orchestrator(automations: readonly unknown[], runs: readonly unknown[] = []) {
  return {
    connectionStateSignal: () => ONLINE,
    listAutomations: async () => ({ automations, keepsDaemonAlive: true }),
    automationRuns: async () => ({ runs }),
    listTasks: () => [{ repo: REPO }],
  } as never
}

test("the routines cursor scrolls into view instead of walking off the page", async () => {
  // Twelve three-cell strips against a 24-row page: everything past the
  // fourth is off-frame until the viewport follows the cursor.
  const { frame, mockInput } = await renderComponent(
    <AutomationsPage
      orchestrator={orchestrator(Array.from({ length: 12 }, (_, i) => routine(i + 1)))}
      focused={true}
      onClose={() => {}}
    />,
    { width: 74, height: 24, providers: { dialog: true, notifications: true } },
  )
  await settle(150)
  // Precondition: the tail of the list starts off-frame, so a cursor that
  // reaches it has genuinely left the viewport.
  expect(await frame()).not.toContain("routine-11")

  for (let i = 0; i < 10; i += 1) mockInput.typeText("j")
  await settle(150)

  const after = await frame()
  // The cursor is on routine-11; the detail panel proves where it is and the
  // list proves the viewport came along.
  expect(after).toContain("prompt 11")
  expect(after).toContain("routine-11")
})

test("enter opens the latest run's task, not an older run that happened to make one", async () => {
  // The newest run skipped its precheck (the healthy no-op) so it created no
  // task. Falling through to run #1 opens work from a different day.
  const opened: string[] = []
  const { mockInput } = await renderComponent(
    <AutomationsPage
      orchestrator={orchestrator(
        [routine(1)],
        [
          { id: "r2", runNumber: 2, status: "skipped_precheck", at: "2026-07-02T00:00:00Z" },
          { id: "r1", runNumber: 1, status: "dispatched", at: "2026-07-01T00:00:00Z", taskId: "STALE" },
        ],
      )}
      focused={true}
      onClose={() => {}}
      onOpenTask={(id) => opened.push(id)}
    />,
    { width: 74, height: 20, providers: { dialog: true, notifications: true } },
  )
  await settle(150)
  mockInput.pressEnter()
  await settle(120)
  expect(opened).toEqual([])
})

test("enter follows the latest run when it did make a task", async () => {
  const opened: string[] = []
  const { mockInput } = await renderComponent(
    <AutomationsPage
      orchestrator={orchestrator(
        [routine(1)],
        [
          { id: "r2", runNumber: 2, status: "dispatched", at: "2026-07-02T00:00:00Z", taskId: "LATEST" },
          { id: "r1", runNumber: 1, status: "dispatched", at: "2026-07-01T00:00:00Z", taskId: "STALE" },
        ],
      )}
      focused={true}
      onClose={() => {}}
      onOpenTask={(id) => opened.push(id)}
    />,
    { width: 74, height: 20, providers: { dialog: true, notifications: true } },
  )
  await settle(150)
  mockInput.pressEnter()
  await settle(120)
  expect(opened).toEqual(["LATEST"])
})

function issue(id: number) {
  return { id, title: `story-${id}`, status: "open", created: "2026-08-01", body: "" }
}

function boardOrchestrator() {
  return {
    listTasks: () => [{ id: "T1", repo: REPO }],
    listIssues: async () => ({ repoRoot: REPO, exists: true, nextId: 9, issues: [issue(1), issue(2)] }),
    activeTaskSignal: () => ({ get: () => null }),
  } as never
}

async function boardFrame(width: number): Promise<string> {
  const { frame } = await renderComponent(
    <KanbanPage
      orchestrator={boardOrchestrator()}
      focused={true}
      onClose={() => {}}
      onStartChat={async () => {}}
      onOpenTask={() => {}}
    />,
    { width, height: 30, providers: { dialog: true, kv: true, notifications: true } },
  )
  await settle(150)
  return await frame()
}

test("the board collapses to one lane when four would leave the cards unreadable", async () => {
  // 80 columns clears the 70-column whole-terminal breakpoint, so the board
  // used to keep four lanes and hand each card nine cells — less than the ten
  // its `created` date alone needs. The single-lane strip names every column;
  // only the selected one renders its cards.
  const narrow = await boardFrame(80)
  expect(narrow).toContain("Backlog")
  expect(narrow).toContain("Done")
  // Cards are readable again: a full title, not a one-glyph column.
  expect(narrow).toContain("story-1")

  // Wide is untouched — four lanes, each with its own count.
  const wide = await boardFrame(140)
  expect(wide).toContain("Backlog (2)")
  expect(wide).toContain("In progress (0)")
  expect(wide).toContain("Parked (0)")
  expect(wide).toContain("Done (0)")
})
