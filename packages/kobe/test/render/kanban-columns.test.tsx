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
