/** @jsxImportSource @opentui/react */
/**
 * What the board actually RENDERS for its two routing rules, against the real
 * component rather than the pure column math that
 * `test/state/issue-board.test.ts` already covers:
 *
 *   - a `hold` story lands under Parked even though it is linked to a task
 *     (routing on the link alone puts shelved stories in In progress,
 *     pretending to be active work);
 *   - a card whose linked engine is blocked leads its column, and the header
 *     says how many need you.
 */
import { expect, test } from "bun:test"
import type { TaskEngineState } from "../../src/client/remote-orchestrator-payloads"
import { KanbanPage } from "../../src/tui-react/component/kanban-page"
import { setTransparentBackground } from "../../src/tui-react/context/theme"
import { renderComponent, settle } from "./harness"

const REPO = "/repos/rove"

function issue(id: number, over: Record<string, unknown> = {}) {
  return { id, title: `story-${id}`, status: "open", created: "2026-08-01", body: "", ...over }
}

/** What KanbanPage touches on mount; everything else is unused here.
 *  `listTasks` carries real ids because the board resolves each card's link
 *  against it — a link naming a task the list doesn't have reads as unlinked. */
function orchestrator(
  issues: readonly unknown[],
  tasks: readonly unknown[] = [
    { id: "T1", repo: REPO },
    { id: "T2", repo: REPO },
  ],
) {
  return {
    listTasks: () => tasks,
    listIssueRepos: async () => [REPO],
    listIssues: async () => ({ repoRoot: REPO, exists: true, nextId: 99, issues }),
    activeTaskSignal: () => ({ get: () => null }),
  } as never
}

async function board(
  issues: readonly unknown[],
  engineStates?: ReadonlyMap<string, TaskEngineState>,
  tasks?: readonly unknown[],
) {
  const { frame } = await renderComponent(
    <KanbanPage
      orchestrator={tasks ? orchestrator(issues, tasks) : orchestrator(issues)}
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
 * A link the task index cannot resolve reads as unlinked. The daemon unlinks
 * an issue when its task is deleted, so this is the belt to that braces: a
 * store carried over from a build without the cascade still holds dead links,
 * and In progress would be a one-way door for them — the drawer swaps Start
 * for "open the linked session", which jumps at nothing. In Backlog the card
 * is startable again.
 */
test("a card linked to a task the index does not have renders in Backlog", async () => {
  const text = await board([issue(1, { taskId: "T1" }), issue(2, { taskId: "GONE" })], undefined, [
    { id: "T1", repo: REPO },
  ])
  const backlog = text.indexOf("Backlog")
  const inProgress = text.indexOf("In progress")
  // Columns render side by side, so a card's COLUMN is the header its text
  // sits under — compare the cards' horizontal offsets on their own rows.
  const columnOf = (title: string) => {
    const row = text.split("\n").find((line) => line.includes(title)) ?? ""
    return row.indexOf(title) < inProgress - backlog + 4 ? "backlog" : "in_progress"
  }
  expect(columnOf("story-2")).toBe("backlog")
  expect(columnOf("story-1")).toBe("in_progress")
})

/**
 * Where a card's breathing room lives, now that `padding={1}` is gone.
 *
 * That one prop was doing three jobs — air inside the card, separation from
 * the next card, and a break between title and description — and charged two
 * rows per card for it. It is split: horizontal padding on the card, a
 * `marginBottom` for the lane gap, and the title/description break falls out
 * of the box gap. This pins the two that are invisible in the source: a
 * `marginBottom` Yoga silently drops renders exactly like one that was never
 * written.
 */
test("a card's title sits against its own top border, with a blank lane row after it", async () => {
  const lines = (await board([issue(1), issue(2)])).split("\n")
  // Newest first, so story-2 leads — index by content, not by argument order.
  const first = lines.findIndex((line) => line.includes("story-2"))
  const second = lines.findIndex((line) => line.includes("story-1"))
  expect(first).toBeGreaterThan(0)
  expect(second).toBeGreaterThan(first)

  // Directly above the title is the card's own top border, not a padded row:
  // the two rows a `padding={1}` would spend are what this buys back.
  expect(lines[first - 1] ?? "").toContain("╭")

  // Between the cards, exactly one row carrying no card chrome — the lane
  // separator that `marginBottom` now owns, since a scrollbox has no `gap`.
  const between = lines.slice(first + 1, second)
  const closed = between.findIndex((line) => line.includes("╰"))
  expect(closed).toBeGreaterThanOrEqual(0)
  const gap = between[closed + 1] ?? ""
  expect(gap).not.toContain("╭")
  expect(gap).not.toContain("╰")
  // ...and the very next row opens the following card, so the gap is ONE row.
  expect(between[closed + 2] ?? "").toContain("╭")
})

/**
 * Both framed surfaces on the board — the four columns and the cards inside
 * them — draw ROUNDED corners, the same grammar the workspace pane, files
 * pane and tab strip already use.
 *
 * Pinned against the frame because opentui's default is SQUARE: a box that
 * says `border` and nothing else silently opts out of the house style, which
 * would leave the board the one page framed in `┌┐└┘`. Asserting the
 * absence of square glyphs is what makes this test fail if either box loses
 * its `borderStyle` again — a corner-count assertion alone would pass on the
 * default.
 */
test("columns and cards are framed in rounded corners, never square", async () => {
  const text = await board([issue(1)])
  expect(text).toContain("╭")
  expect(text).toContain("╯")
  expect(text).not.toContain("┌")
  expect(text).not.toContain("┘")
  // Four columns plus the one card = five framed boxes, so five of each
  // corner. Without this a single rounded box beside four square ones would
  // still satisfy the checks above.
  const corners = (glyph: string): number => text.split(glyph).length - 1
  expect(corners("╭")).toBe(5)
  expect(corners("╰")).toBe(5)
})

/**
 * Transparent mode reaches the cards too.
 *
 * The card was the one surface on the board that kept a solid fill when the
 * user asked for transparency — on the theory that a card is content rather
 * than chrome. But a solid tile is precisely the thing you cannot see through,
 * so the exception read as the board ignoring the setting.
 *
 * Asserted on the rendered SPAN, not the prop: a `backgroundColor` the
 * renderer resolves differently than the source suggests is invisible in a
 * prop check and obvious here.
 */
test("a card is see-through in transparent mode and solid outside it", async () => {
  const cardBackgrounds = async (): Promise<string[]> => {
    const { spans } = await renderComponent(
      <KanbanPage
        orchestrator={orchestrator([issue(1)])}
        focused={true}
        onClose={() => {}}
        onStartChat={async () => {}}
        onOpenTask={() => {}}
      />,
      { width: 120, height: 30, providers: { dialog: true, kv: true, notifications: true } },
    )
    await settle()
    const captured = await spans()
    const seen = new Set<string>()
    for (const line of captured.lines) {
      for (const span of line.spans) if (span.text.includes("story-1")) seen.add(String(span.bg))
    }
    return [...seen]
  }

  setTransparentBackground(true)
  const transparent = await cardBackgrounds()
  expect(transparent).toHaveLength(1)
  // Alpha 0 — the host terminal shows through.
  expect(transparent[0]).toContain("0.00)")

  setTransparentBackground(false)
  const opaque = await cardBackgrounds()
  expect(opaque).toHaveLength(1)
  // Opaque mode is untouched: the card keeps its tinted surface.
  expect(opaque[0]).toContain("1.00)")

  // The harness default; leaving it flipped would silently retheme every test
  // that runs after this one.
  setTransparentBackground(true)
})

/**
 * The board's keys are live, not decoration: `r` refetches. A page whose
 * bindings silently do nothing renders identically to a working one — a
 * `Binding[]` passed as an object literal is enough to kill every key on a
 * page and change nothing on screen.
 */
test("r refetches the board", async () => {
  let fetches = 0
  const orch = {
    listTasks: () => [{ repo: REPO }],
    listIssueRepos: async () => [REPO],
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
 * were one-word-per-line strips. The off-lane cards must NOT render — their
 * presence is the whole failure mode.
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
