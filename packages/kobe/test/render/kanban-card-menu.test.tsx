/** @jsxImportSource @opentui/react */
/**
 * Moving a card WITHOUT the drawer: right-click → pick a status → the store
 * write.
 *
 * `kanban-status-write.test.tsx` covers the drawer's route to the same
 * `setStatus` op. This covers the one the board grew so a five-session day
 * doesn't cost four keystrokes per card, and it drives a REAL right-click
 * through the renderer for the reason the sidebar's menu test does: the risky
 * part is not the menu, it is whether button 2 survives the mouse pipeline
 * onto a card that also owns a left-click select/open handler.
 */

import { expect, test } from "bun:test"
import { KanbanPage } from "../../src/tui-react/component/kanban-page"
import { act, renderComponent, settle } from "./harness"

const REPO = "/repos/rove"
// Short enough to stay on ONE line inside the card: the title wraps at the
// lane width, and a needle split across two rows has no single click target.
const STORY = { id: 1, title: "Retry loop", status: "open", created: "2026-08-01", body: "" }
const RIGHT = 2

function board() {
  const mutations: unknown[] = []
  const orchestrator = {
    listTasks: () => [],
    listIssueRepos: async () => [REPO],
    listIssues: async () => ({ repoRoot: REPO, exists: true, nextId: 99, issues: [STORY] }),
    activeTaskSignal: () => ({ get: () => null }),
    mutateIssue: async (_repo: string, op: unknown) => {
      mutations.push(op)
      return { repoRoot: REPO, exists: true, nextId: 99, issues: [STORY] }
    },
  } as never
  return { mutations, orchestrator }
}

async function mount() {
  const { mutations, orchestrator } = board()
  const handle = await renderComponent(
    <KanbanPage
      orchestrator={orchestrator}
      focused={true}
      onClose={() => {}}
      onStartChat={async () => {}}
      onOpenTask={() => {}}
    />,
    { width: 120, height: 40, providers: { dialog: true, kv: true, notifications: true } },
  )
  await settle()
  return { ...handle, mutations }
}

/** Screen row of the first line containing `needle`. */
function lineOf(text: string, needle: string): number {
  const at = text.split("\n").findIndex((line) => line.includes(needle))
  expect(at).toBeGreaterThan(-1)
  return at
}

/** Screen column of `needle` on its own line. */
function columnOf(text: string, needle: string): number {
  const line = text.split("\n").find((entry) => entry.includes(needle)) ?? ""
  return line.indexOf(needle)
}

async function openMenu() {
  const handle = await mount()
  const before = await handle.frame()
  const row = lineOf(before, STORY.title)
  await act(async () => {
    await handle.mockMouse.click(columnOf(before, STORY.title), row, RIGHT)
  })
  await settle()
  return handle
}

test("right-clicking a card offers every status except the one it is already in", async () => {
  const { frame } = await openMenu()
  const shown = await frame()
  // `open` is the card's CURRENT status, so picking it would write nothing —
  // its absence is also what tells you which one you are on.
  expect(shown).toContain("status → doing")
  expect(shown).toContain("status → hold")
  expect(shown).toContain("status → done")
  expect(shown).not.toContain("status → open")
})

test("picking a status writes it as a setStatus op", async () => {
  const { frame, mockInput, mutations } = await openMenu()
  // The menu opens on its first entry (`doing`); enter fires it. No new
  // chord — up/down/enter/escape are what every popup already answers to.
  act(() => mockInput.pressEnter())
  await settle()
  expect(mutations).toEqual([{ type: "setStatus", id: 1, status: "doing" }])
  // And the menu is gone: it closes BEFORE dispatching, so it can't hang over
  // a board the reload has re-shuffled underneath it.
  expect(await frame()).not.toContain("status → doing")
})

test("escape closes the menu without writing", async () => {
  const { frame, mockInput, mutations } = await openMenu()
  act(() => mockInput.pressEscape())
  await settle()
  expect(await frame()).not.toContain("status → doing")
  expect(mutations).toEqual([])
})

test("a right-click never falls through to the card's open handler", async () => {
  // The right-click branch lives inside the card's existing onMouseUp, so a
  // missing early return would ALSO open the detail drawer underneath.
  const { frame } = await openMenu()
  expect(await frame()).not.toContain("STATUS")
})
