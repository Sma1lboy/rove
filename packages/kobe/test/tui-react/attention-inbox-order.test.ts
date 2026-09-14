import { ATTENTION_INBOX_STATES } from "@sma1lboy/kobe-daemon/daemon/contracts"
import { describe, expect, test } from "vitest"
import type { AttentionInboxItem } from "../../src/client/remote-orchestrator"
import {
  attentionInboxCounts,
  attentionInboxKey,
  isAttentionInboxItemAvailable,
  nextAttentionInboxTarget,
  partitionAttentionInboxAvailability,
  sortAttentionInbox,
  visitResolvedEpisodes,
} from "../../src/tui-react/workspace/attention-inbox-core"
import { toTaskId } from "../../src/types/task"

const item = (
  taskId: string,
  tabId: string | null,
  state: AttentionInboxItem["state"],
  at: number,
): AttentionInboxItem => ({ taskId, tabId, state, unread: true, at })

// Queue-drain model (owner 2026-07-16): every stored episode is pending —
// opening one removes it, a fresh event on the same task+tab replaces the
// stale one at the latest position. The list reads oldest → latest, top-down
// WITHIN each band: episodes that are BLOCKED on a human come before finished
// turns, because F7 walks this order and a stuck agent must not queue behind
// four turns that simply ended.
describe("attention inbox ordering", () => {
  test("counts every pending episode", () => {
    expect(attentionInboxCounts([item("a", null, "error", 1), item("b", null, "turn_complete", 2)])).toEqual({
      total: 2,
    })
    expect(attentionInboxCounts([])).toEqual({ total: 0 })
  })

  test("blocked episodes come first, oldest-first inside each band", () => {
    const ordered = sortAttentionInbox(
      [
        item("b", "tab-1", "turn_complete", 10),
        item("a", "tab-2", "error", 9),
        item("a", "tab-1", "permission_needed", 11),
        item("b", "tab-2", "rate_limited", 8),
      ],
      ["a", "b"],
    )
    // The three blocked ones in age order, then the finished turn — which is
    // NEWER than two of them and still sorts last.
    expect(ordered.map(attentionInboxKey)).toEqual(["b\u0000tab-2", "a\u0000tab-2", "a\u0000tab-1", "b\u0000tab-1"])
  })

  test("a NEWER blocked episode still outranks an older finished turn", () => {
    // The five-session case the band exists for: four turns landed while one
    // agent sat on a permission prompt. Age alone buries the prompt; F7 must
    // reach it first.
    const ordered = sortAttentionInbox(
      [
        item("a", "tab-1", "turn_complete", 1),
        item("b", "tab-1", "turn_complete", 2),
        item("c", "tab-1", "turn_complete", 3),
        item("d", "tab-1", "permission_needed", 99),
      ],
      ["a", "b", "c", "d"],
    )
    expect(ordered.map(attentionInboxKey)).toEqual(["d\u0000tab-1", "a\u0000tab-1", "b\u0000tab-1", "c\u0000tab-1"])
  })

  // Read off the daemon's own list rather than restating it, so a state added
  // to `ATTENTION_INBOX_STATES` is covered here the day it lands.
  test("every non-completion state bands as blocking", () => {
    const blocking = ATTENTION_INBOX_STATES.filter((state) => state !== "turn_complete")
    expect(blocking.length).toBeGreaterThan(0)
    for (const state of blocking) {
      // The blocked one is the NEWEST, so only the band can float it.
      const ordered = sortAttentionInbox(
        [item("a", "tab-1", "turn_complete", 1), item("b", "tab-1", state, 2)],
        ["a", "b"],
      )
      expect(ordered.map((entry) => entry.state)).toEqual([state, "turn_complete"])
    }
  })

  test("a queue of one kind keeps its plain oldest-first order", () => {
    const ordered = sortAttentionInbox(
      [
        item("c", "tab-1", "turn_complete", 3),
        item("a", "tab-1", "turn_complete", 1),
        item("b", "tab-1", "turn_complete", 2),
      ],
      ["a", "b", "c"],
    )
    expect(ordered.map(attentionInboxKey)).toEqual(["a\u0000tab-1", "b\u0000tab-1", "c\u0000tab-1"])
  })

  test("breaks same-instant ties by task order for stability", () => {
    const first = item("a", "tab-1", "error", 5)
    const second = item("b", "tab-1", "turn_complete", 5)
    expect(sortAttentionInbox([second, first], ["a", "b"])).toEqual([first, second])
  })

  test("F7 cycles pending task and chat-tab episodes without removing them", () => {
    const items = [
      item("c", "tab-3", "permission_needed", 7),
      item("a", "tab-1", "error", 8),
      item("b", "tab-2", "turn_complete", 9),
    ]
    const target = nextAttentionInboxTarget(items, ["a", "b", "c"], { taskId: "a", tabId: "tab-1" })
    expect(target?.taskId).toBe("b")
    expect(items).toHaveLength(3)
  })

  test("returns the only current pending episode so F7 can resolve it", () => {
    const items = [item("a", "tab-1", "error", 8)]
    expect(nextAttentionInboxTarget(items, ["a"], { taskId: "a", tabId: "tab-1" })).toBe(items[0])
  })

  test("retains unavailable task episodes in the sorted list but skips them for F7", () => {
    const missing = item("deleted", null, "error", 8)
    const live = item("live", null, "turn_complete", 9)
    expect(sortAttentionInbox([missing, live], ["live"])).toContain(missing)
    expect(nextAttentionInboxTarget([missing, live], ["live"], { taskId: null, tabId: null })).toBe(live)
  })

  test("skips a retained episode whose chat tab has closed", () => {
    const closed = item("live", "closed", "error", 8)
    const open = item("live", "open", "turn_complete", 9)
    expect(
      nextAttentionInboxTarget(
        [closed, open],
        ["live"],
        { taskId: null, tabId: null },
        (candidate) => candidate.tabId === "open",
      ),
    ).toBe(open)
  })

  // Visited = handled: landing on a tab resolves its episode without an
  // explicit open — the queue must never show attention the user has
  // already looked at.
  test("visiting a tab resolves its exact episode plus the task-level one", () => {
    const exact = item("a", "tab-1", "turn_complete", 1)
    const otherTab = item("a", "tab-2", "error", 2)
    const taskLevel = item("a", null, "permission_needed", 3)
    const otherTask = item("b", "tab-1", "error", 4)
    const resolved = visitResolvedEpisodes([exact, otherTab, taskLevel, otherTask], {
      taskId: "a",
      tabId: "tab-1",
    })
    expect(resolved).toEqual([exact, taskLevel])
  })

  test("uses one availability rule for deleting tasks and closed tabs", () => {
    const open = item("live", "open", "error", 8)
    expect(isAttentionInboxItemAvailable(open, { deletion: undefined }, (id) => id === "open")).toBe(true)
    expect(
      isAttentionInboxItemAvailable(
        open,
        { deletion: { phase: "queued", force: false, requestedAt: "2026-07-15T00:00:00.000Z" } },
        () => true,
      ),
    ).toBe(false)
    expect(isAttentionInboxItemAvailable(open, { deletion: undefined }, () => false)).toBe(false)
  })

  test("counts only available episodes for the always-visible Inbox header", () => {
    const available = item("live", null, "turn_complete", 1)
    const closedTab = item("live", "closed", "error", 2)
    const deleting = item("deleting", null, "permission_needed", 3)
    const deleted = item("deleted", null, "error", 4)
    const partitioned = partitionAttentionInboxAvailability(
      [available, closedTab, deleting, deleted],
      [
        { id: toTaskId("live"), deletion: undefined },
        {
          id: toTaskId("deleting"),
          deletion: { phase: "queued", force: false, requestedAt: "2026-07-15T00:00:00.000Z" },
        },
      ],
      (_taskId, tabId) => tabId === "open",
    )

    expect(partitioned.availableItems).toEqual([available])
    expect(partitioned.unavailableItems).toEqual([closedTab, deleting, deleted])
    expect(attentionInboxCounts(partitioned.availableItems)).toEqual({ total: 1 })
  })
})
