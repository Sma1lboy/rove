import { describe, expect, test } from "vitest"
import type { AttentionInboxItem } from "../../src/client/remote-orchestrator"
import {
  type InboxRow,
  attentionInboxKey,
  clampSelectableRow,
  inboxRows,
  isAttentionInboxItemAvailable,
  nextAttentionInboxTarget,
  nextSelectableRow,
  partitionAttentionInboxAvailability,
  windowInboxRows,
} from "../../src/tui-react/workspace/attention-inbox-core"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"

const item = (
  taskId: string,
  tabId: string | null,
  state: AttentionInboxItem["state"],
  at: number,
): AttentionInboxItem => ({ taskId, tabId, state, unread: true, at })

const task = (id: string, updatedAt: string, overrides: Partial<Task> = {}): Task => ({
  id: toTaskId(id),
  title: id,
  repo: "/repo",
  branch: `feat/${id}`,
  worktreePath: `/wt/${id}`,
  status: "backlog",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt,
  ...overrides,
})

// One box, two sections: pending attention (unread by definition) always
// leads, recently-touched tasks trail it.
describe("inbox rows", () => {
  test("puts every pending episode above the recent tasks", () => {
    const older = item("a", "tab-1", "error", 1)
    const newer = item("b", "tab-1", "turn_complete", 2)
    const rows = inboxRows(
      [newer, older],
      [
        task("a", "2026-07-02T00:00:00.000Z"),
        task("b", "2026-07-03T00:00:00.000Z"),
        task("c", "2026-07-04T00:00:00.000Z"),
      ],
    )
    expect(rows.map((row) => row.id)).toEqual([
      "header:attention",
      `a:${attentionInboxKey(older)}`,
      `a:${attentionInboxKey(newer)}`,
      "header:recent",
      "r:c",
    ])
  })

  test("never repeats a task that already has a pending episode, or the open one", () => {
    const rows = inboxRows(
      [item("a", "tab-1", "error", 1)],
      [
        task("a", "2026-07-04T00:00:00.000Z"),
        task("b", "2026-07-03T00:00:00.000Z"),
        task("c", "2026-07-02T00:00:00.000Z"),
      ],
      { selectedId: "b" },
    )
    expect(rows.filter((row) => row.kind === "recent").map((row) => row.id)).toEqual(["r:c"])
  })

  // Owner report 2026-08-10: switching among ONE task's chat tabs left RECENT
  // showing unrelated tasks. Rows are per (task, tab) — every tab you left is
  // its own row, and only the tab you're on is dropped.
  test("lists each visited tab of the open task, minus the tab you're on", () => {
    const rows = inboxRows([], [task("a", "2026-07-04T00:00:00.000Z"), task("b", "2026-07-01T00:00:00.000Z")], {
      selectedId: "a",
      selectedTabId: "tab-3",
      visits: [
        { taskId: "a", tabId: "tab-3", at: 400 },
        { taskId: "a", tabId: "tab-2", at: 300 },
        { taskId: "a", tabId: "tab-1", at: 200 },
      ],
    })
    expect(rows.map((row) => row.id)).toEqual(["header:recent", "r:a:tab-2", "r:a:tab-1", "r:b"])
  })

  // Without a known active tab there is nothing tab-precise to say, so the
  // whole selected task stays hidden (the pre-per-tab behavior).
  test("hides the whole selected task when its active tab is unknown", () => {
    const rows = inboxRows([], [task("a", "2026-07-04T00:00:00.000Z")], {
      selectedId: "a",
      selectedTabId: null,
      visits: [
        { taskId: "a", tabId: "tab-2", at: 300 },
        { taskId: "a", tabId: "tab-1", at: 200 },
      ],
    })
    expect(rows).toEqual([])
  })

  // Nothing prunes the visit log when a tab closes, and a row whose tab is
  // gone renders with the TASK's label — so several of them read as duplicate
  // rows that each eat a slot and open nothing. Same tri-state rule as
  // episodes: confirmed-gone drops, unreadable keeps.
  test("drops visited rows whose tab has closed, keeps the unreadable ones", () => {
    const opts = {
      visits: [
        { taskId: "a", tabId: "tab-1", at: 300 },
        { taskId: "a", tabId: "tab-2", at: 200 },
        { taskId: "a", tabId: "tab-3", at: 100 },
      ],
    }
    const tasks = [task("a", "2026-07-04T00:00:00.000Z")]
    const pruned = inboxRows([], tasks, { ...opts, tabExists: (_id, tabId) => tabId === "tab-2" })
    expect(pruned.filter((row) => row.kind === "recent").map((row) => row.id)).toEqual(["r:a:tab-2"])

    // No probe at all, or one that can't read the list: every row survives.
    expect(inboxRows([], tasks, opts).filter((row) => row.kind === "recent")).toHaveLength(3)
    expect(
      inboxRows([], tasks, { ...opts, tabExists: () => undefined }).filter((row) => row.kind === "recent"),
    ).toHaveLength(3)
  })

  // A tab-scoped episode only shadows ITS tab; a task-level one shadows all.
  test("drops only the tabs an episode already covers", () => {
    const tabScoped = inboxRows([item("a", "tab-1", "error", 1)], [task("a", "2026-07-04T00:00:00.000Z")], {
      visits: [
        { taskId: "a", tabId: "tab-1", at: 300 },
        { taskId: "a", tabId: "tab-2", at: 200 },
      ],
    })
    expect(tabScoped.filter((row) => row.kind === "recent").map((row) => row.id)).toEqual(["r:a:tab-2"])

    const taskScoped = inboxRows([item("a", null, "error", 1)], [task("a", "2026-07-04T00:00:00.000Z")], {
      visits: [
        { taskId: "a", tabId: "tab-1", at: 300 },
        { taskId: "a", tabId: "tab-2", at: 200 },
      ],
    })
    expect(taskScoped.filter((row) => row.kind === "recent")).toEqual([])
  })

  test("orders recent tasks newest first, skips deleting tasks, and caps the tail", () => {
    const rows = inboxRows(
      [],
      [
        task("old", "2026-07-01T00:00:00.000Z"),
        task("new", "2026-07-09T00:00:00.000Z"),
        task("gone", "2026-07-10T00:00:00.000Z", {
          deletion: { phase: "queued", force: false, requestedAt: "2026-07-15T00:00:00.000Z" },
        }),
      ],
      { recentLimit: 1 },
    )
    expect(rows.map((row) => row.id)).toEqual(["header:recent", "r:new"])
  })

  // Visit order beats mtime: a task the user actually opened outranks one
  // a background mutation (PR status, vendor change) merely touched.
  test("ranks visited tasks by visit order, never-visited ones after them", () => {
    const rows = inboxRows(
      [],
      [
        task("touched", "2026-07-20T00:00:00.000Z"),
        task("seen-first", "2026-07-01T00:00:00.000Z"),
        task("seen-last", "2026-07-02T00:00:00.000Z"),
      ],
      {
        visits: [
          { taskId: "seen-last", tabId: "tab-2", at: 900 },
          { taskId: "seen-first", tabId: null, at: 100 },
        ],
      },
    )
    expect(rows.map((row) => row.id)).toEqual(["header:recent", "r:seen-last:tab-2", "r:seen-first", "r:touched"])
  })

  test("carries the visited tab and visit time, falling back to the task mtime", () => {
    const rows = inboxRows([], [task("seen", "2026-07-01T00:00:00.000Z"), task("fresh", "2026-07-02T00:00:00.000Z")], {
      visits: [{ taskId: "seen", tabId: "tab-7", at: 4242 }],
    })
    const recent = rows.filter((row) => row.kind === "recent")
    expect(recent[0]).toMatchObject({ id: "r:seen:tab-7", tabId: "tab-7", at: 4242 })
    expect(recent[1]).toMatchObject({ id: "r:fresh", tabId: null, at: Date.parse("2026-07-02T00:00:00.000Z") })
  })

  test("drops a section header when its section is empty", () => {
    expect(inboxRows([], []).length).toBe(0)
    expect(
      inboxRows([item("a", null, "error", 1)], [task("a", "2026-07-02T00:00:00.000Z")]).map((r) => r.kind),
    ).toEqual(["header", "attention"])
  })
})

describe("inbox cursor", () => {
  const rows = inboxRows(
    [item("a", "tab-1", "error", 1)],
    [task("a", "2026-07-02T00:00:00.000Z"), task("b", "2026-07-03T00:00:00.000Z")],
  )

  test("steps over section headers and wraps both ways", () => {
    expect(rows.map((row) => row.kind)).toEqual(["header", "attention", "header", "recent"])
    expect(nextSelectableRow(rows, 1, 1)).toBe(3)
    expect(nextSelectableRow(rows, 3, 1)).toBe(1)
    expect(nextSelectableRow(rows, 1, -1)).toBe(3)
  })

  test("snaps a stale cursor off a header and back inside the list", () => {
    expect(clampSelectableRow(rows, 0)).toBe(1)
    expect(clampSelectableRow(rows, 2)).toBe(3)
    expect(clampSelectableRow(rows, 99)).toBe(3)
    expect(clampSelectableRow([], 3)).toBe(0)
  })
})

// Availability decides whether the host DELETES an episode from the daemon
// (use-inbox-host's background cleanup), so "don't know" must never read as
// "gone" — the regression below cost real episodes.
describe("attention inbox availability", () => {
  const live = { id: toTaskId("a"), deletion: undefined }

  test("keeps an episode whose tab is present", () => {
    expect(isAttentionInboxItemAvailable(item("a", "tab-1", "turn_complete", 1), live, () => true)).toBe(true)
  })

  test("drops an episode whose task is deleting or gone", () => {
    expect(isAttentionInboxItemAvailable(item("a", "tab-1", "turn_complete", 1), undefined, () => true)).toBe(false)
    expect(
      isAttentionInboxItemAvailable(
        item("a", "tab-1", "turn_complete", 1),
        { ...live, deletion: { phase: "queued", force: false, requestedAt: "2026-07-15T00:00:00.000Z" } },
        () => true,
      ),
    ).toBe(false)
  })

  test("drops an episode whose tab is confirmed closed", () => {
    expect(isAttentionInboxItemAvailable(item("a", "tab-1", "turn_complete", 1), live, () => false)).toBe(false)
  })

  test("a task-level episode needs no tab", () => {
    expect(isAttentionInboxItemAvailable(item("a", null, "turn_complete", 1), live, () => false)).toBe(true)
  })

  // Regression (owner report 2026-08-10): "sometimes two tabs are unread but
  // the Inbox only lists one." The tab lookup reads a per-task KV snapshot
  // that only exists once THIS process has mounted that task's TerminalTabs;
  // for any other task it answered "no such tab", the host judged the
  // episode unavailable, and its background cleanup deleted it from the
  // daemon for good — while the sidebar lamp, which reads a different
  // source, stayed lit.
  test("an unreadable tab list (undefined) keeps the episode instead of deleting it", () => {
    expect(isAttentionInboxItemAvailable(item("a", "tab-1", "turn_complete", 1), live, () => undefined)).toBe(true)
    const { availableItems, unavailableItems } = partitionAttentionInboxAvailability(
      [item("a", "tab-1", "turn_complete", 1), item("a", "tab-2", "turn_complete", 2)],
      [live],
      () => undefined,
    )
    expect(availableItems).toHaveLength(2)
    expect(unavailableItems).toHaveLength(0)
  })
})

// The pane's window budgets CARDS, not rows: a header is one line against a
// card's three, and charging it a card slot both shrank the window and let a
// trailing "RECENT" header dangle with every row under it clipped silently.
describe("windowInboxRows", () => {
  const header = (section: "attention" | "recent"): InboxRow => ({ kind: "header", id: `header:${section}`, section })
  const card = (id: string): InboxRow => ({ kind: "attention", id, item: item(id, null, "error", 1) })

  const queue = [header("attention"), card("a"), card("b"), card("c"), card("d"), header("recent"), card("e")]

  test("everything fits: no clipping, headers included", () => {
    const { visible, hiddenAbove, hiddenBelow } = windowInboxRows(queue, 1, 5)
    expect(visible).toEqual(queue)
    expect(hiddenAbove).toBe(0)
    expect(hiddenBelow).toBe(0)
  })

  test("clips below and reports the hidden card count", () => {
    const { visible, hiddenAbove, hiddenBelow } = windowInboxRows(queue, 1, 3)
    expect(visible.map((row) => row.id)).toEqual(["header:attention", "a", "b", "c"])
    expect(hiddenAbove).toBe(0)
    expect(hiddenBelow).toBe(2)
  })

  test("slides so the cursor's card stays visible and reports hidden above", () => {
    const cursorOnLast = queue.length - 1
    const { visible, hiddenAbove, hiddenBelow } = windowInboxRows(queue, cursorOnLast, 3)
    expect(visible.map((row) => row.id)).toEqual(["c", "d", "header:recent", "e"])
    expect(hiddenAbove).toBe(2)
    expect(hiddenBelow).toBe(0)
  })

  test("a window starting at a section's first card keeps that header", () => {
    const { visible } = windowInboxRows(queue, queue.length - 1, 1)
    expect(visible.map((row) => row.id)).toEqual(["header:recent", "e"])
  })
})

describe("a routine episode that names a task", () => {
  // `automation-dispatch.ts` keeps the taskId on a failed firing ("the task
  // may exist while its engine did not start, and the run record is the only
  // place that id survives for a human to open by hand"), so the daemon files
  // `{ state: "routine_failed", taskId: "task-c" }`. Its SUBJECT is still the
  // schedule — opening it lands on the Routines page, not on that task — so
  // every reachability rule has to agree with `isAttentionInboxItemAvailable`.
  const routine: AttentionInboxItem = {
    taskId: "task-c",
    tabId: null,
    state: "routine_failed",
    detail: { routine: { automationId: "auto-1", name: "nightly", status: "dispatch_failed" } },
    unread: true,
    at: 10,
  }

  test("is reachable from F7 even though its task is gone", () => {
    // `taskOrder` is the LIVE task list. A fresh-task routine mints a task per
    // firing and the user deletes them, so the named task is routinely absent;
    // gating on it left the episode listed in the pane and skipped by F7 —
    // visible, unreachable, and never cleaned up.
    expect(nextAttentionInboxTarget([routine], [], { taskId: null, tabId: null })).toEqual(routine)
    expect(isAttentionInboxItemAvailable(routine, undefined, () => undefined)).toBe(true)
  })

  test("joins the ring next to live episodes instead of being stepped over", () => {
    // F7 walks oldest-first and wraps. Standing on the live episode, the next
    // stop is the routine — which is the whole point: before, the walk filtered
    // it out on `liveTasks.has("task-c")` and announced "nothing needs you".
    const live = item("task-a", "tab-1", "permission_needed", 20)
    expect(nextAttentionInboxTarget([live, routine], ["task-a"], { taskId: "task-a", tabId: "tab-1" })).toEqual(routine)
  })
})
