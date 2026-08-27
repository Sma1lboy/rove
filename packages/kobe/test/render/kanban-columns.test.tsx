/** @jsxImportSource @opentui/react */
/**
 * What the board actually RENDERS for the two routing rules this branch
 * added, against the real component rather than the pure column math that
 * `test/state/issue-board.test.ts` already covers:
 *
 *   - a `hold` story lands under Parked even though it is linked to a task
 *     (before, the link alone pushed it into In progress, where more than a
 *     dozen shelved stories sat pretending to be active work);
 *   - a card whose linked engine is blocked leads its column, and the header
 *     says how many need you.
 */
import { expect, test } from "bun:test"
import type { TaskEngineState } from "../../src/client/remote-orchestrator-payloads"
import { KanbanPage } from "../../src/tui-react/component/kanban-page"
import { renderComponent, settle } from "./harness"

const REPO = "/repos/rove"

function issue(id: number, over: Record<string, unknown> = {}) {
  return { id, title: `story-${id}`, status: "open", created: "2026-08-01", body: "", ...over }
}

/** What KanbanPage touches on mount; everything else is unused here. */
function orchestrator(issues: readonly unknown[]) {
  return {
    listTasks: () => [{ repo: REPO }],
    listIssues: async () => ({ repoRoot: REPO, exists: true, nextId: 99, issues }),
    activeTaskSignal: () => ({ get: () => null }),
  } as never
}

async function board(issues: readonly unknown[], engineStates?: ReadonlyMap<string, TaskEngineState>) {
  const { frame } = await renderComponent(
    <KanbanPage
      orchestrator={orchestrator(issues)}
      focused={true}
      onClose={() => {}}
      onStartChat={async () => {}}
      onOpenTask={() => {}}
      {...(engineStates ? { engineStates } : {})}
    />,
    { width: 120, height: 30, providers: { dialog: true, kv: true, notifications: true } },
  )
  // The issue fetch is async — let it land before reading the frame.
  await settle()
  return await frame()
}

test("a linked hold story renders under Parked, not In progress", async () => {
  const text = await board([issue(1, { status: "hold", taskId: "T1" }), issue(2, { taskId: "T2" })])
  expect(text).toContain("Parked")
  const parkedCol = text.indexOf("Parked")
  const doneCol = text.indexOf("Done")
  // Column order is Backlog · In progress · Parked · Done — Parked sits
  // between the active lane and the finished one, so it reads as a stage.
  expect(parkedCol).toBeGreaterThan(text.indexOf("In progress"))
  expect(doneCol).toBeGreaterThan(parkedCol)
})

test("a blocked card's column header reports how many need you", async () => {
  const states = new Map<string, TaskEngineState>([["T2", { state: "permission_needed", at: 1 }]])
  const text = await board([issue(1, { taskId: "T1" }), issue(2, { taskId: "T2" })], states)
  expect(text).toContain("need you")
  // A board with nothing blocked must not spend a single cell on the count.
  const quiet = await board([issue(1, { taskId: "T1" })], new Map([["T1", { state: "running", at: 1 }]]))
  expect(quiet).not.toContain("need you")
})

/**
 * The card is padded on all four sides — the title used to sit flush against
 * the top border while the sides had a cell each. Padding read off a frame,
 * not off the prop: a `padding` that Yoga silently drops renders identically
 * to one that never existed.
 */
test("a card pads its title away from its own border", async () => {
  const lines = (await board([issue(1)])).split("\n")
  const title = lines.findIndex((line) => line.includes("story-1"))
  expect(title).toBeGreaterThan(0)
  // The row above the title belongs to the card and carries no glyphs of its
  // own — the card's top border is one row further up.
  const above = lines[title - 1] ?? ""
  expect(above).toContain("│")
  expect(above).not.toContain("┌")
  expect(above.replace(/[│ ]/g, "")).toBe("")
})

/**
 * The board's keys are live, not decoration: `r` refetches. A page whose
 * bindings silently do nothing renders identically to a working one, which is
 * exactly how the Automations page once shipped with every key dead.
 */
test("r refetches the board", async () => {
  let fetches = 0
  const orch = {
    listTasks: () => [{ repo: REPO }],
    listIssues: async () => {
      fetches += 1
      return { repoRoot: REPO, exists: true, nextId: 9, issues: [issue(1)] }
    },
    activeTaskSignal: () => ({ get: () => null }),
  } as never
  const { mockInput } = await renderComponent(
    <KanbanPage
      orchestrator={orch}
      focused={true}
      onClose={() => {}}
      onStartChat={async () => {}}
      onOpenTask={() => {}}
    />,
    { width: 120, height: 30, providers: { dialog: true, kv: true, notifications: true } },
  )
  await settle()
  const before = fetches
  mockInput.typeText("r")
  await settle()
  expect(fetches).toBeGreaterThan(before)
})

/**
 * Wide board: an empty lane says so instead of rendering a bare void — a
 * blank bordered box reads as "failed to load", not "nothing parked".
 */
test("an empty column renders its placeholder", async () => {
  const text = await board([issue(1)])
  // Only Backlog holds a card; the other three lanes each show the hint.
  expect(text.match(/No cards/g)?.length).toBe(3)
})

/**
 * Below the narrow breakpoint the board renders ONE full-width lane under a
 * strip of every lane's count — four side-by-side columns at phone width
 * were one-word-per-line strips. The off-lane cards must NOT render: their
 * presence is exactly what the old layout got wrong.
 */
test("narrow board shows a lane strip and only the selected lane's cards", async () => {
  const { frame } = await renderComponent(
    <KanbanPage
      orchestrator={orchestrator([issue(1), issue(2, { taskId: "T2" })])}
      focused={true}
      onClose={() => {}}
      onStartChat={async () => {}}
      onOpenTask={() => {}}
    />,
    { width: 60, height: 34, providers: { dialog: true, kv: true, notifications: true } },
  )
  await settle()
  const text = await frame()
  // The strip names every lane with its count…
  expect(text).toContain("Backlog (1)")
  expect(text).toContain("In progress (1)")
  expect(text).toContain("Done (0)")
  // …and the board shows the selection's lane only (selection defaults to
  // the first non-empty column — Backlog's story-1).
  expect(text).toContain("story-1")
  expect(text).not.toContain("story-2")
})
