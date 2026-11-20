import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { createKvCore } from "../../src/tui-react/context/kv-core"
import {
  type InboxVisit,
  inboxVisitIndex,
  inboxVisitKey,
  parseInboxVisits,
  readInboxVisits,
  recordInboxVisit,
  writeInboxVisit,
} from "../../src/tui-react/workspace/inbox-visits"

const visit = (taskId: string, tabId: string | null, at: number): InboxVisit => ({ taskId, tabId, at })

function fakeKv(seed: unknown = undefined) {
  const store = new Map<string, unknown>()
  if (seed !== undefined) store.set("inboxVisits", seed)
  let writes = 0
  return {
    get: (key: string) => store.get(key),
    update: (key: string, mutate: (current: unknown) => unknown) => {
      writes++
      store.set(key, mutate(store.get(key)))
      return true
    },
    writes: () => writes,
  }
}

// RECENT answers "where was I", so the order comes from a visit log —
// `task.updatedAt` moves on any mutation and would answer "what changed".
describe("inbox visit log", () => {
  test("moves a revisited tab to the front", () => {
    const log = recordInboxVisit([visit("a", "tab-1", 1), visit("b", "tab-2", 2)], visit("b", "tab-2", 3))
    expect(log).toEqual([visit("b", "tab-2", 3), visit("a", "tab-1", 1)])
  })

  // Entries are keyed by (task, TAB). A task-keyed log collapses a whole
  // session of chat-tab switching into one row, so the tabs you just left
  // never appear in RECENT.
  test("keeps a separate entry per tab of the same task", () => {
    const log = recordInboxVisit([visit("a", "tab-1", 1)], visit("a", "tab-2", 2))
    expect(log).toEqual([visit("a", "tab-2", 2), visit("a", "tab-1", 1)])
  })

  test("keeps one entry per (task, tab) and caps the log", () => {
    const log = [visit("a", null, 1), visit("b", null, 2), visit("c", null, 3)].reduce(
      (acc, entry) => recordInboxVisit(acc, entry, 2),
      [] as InboxVisit[],
    )
    expect(log.map((entry) => entry.taskId)).toEqual(["c", "b"])
  })

  test("skips the write when you never left the tab", () => {
    const kv = fakeKv()
    writeInboxVisit(kv, visit("a", "tab-1", 1))
    writeInboxVisit(kv, visit("a", "tab-1", 2))
    expect(kv.writes()).toBe(1)
    // The arrival time stands: `at` reads as "when you last came here".
    expect(readInboxVisits(kv)).toEqual([visit("a", "tab-1", 1)])

    writeInboxVisit(kv, visit("a", "tab-2", 3))
    expect(kv.writes()).toBe(2)
    expect(readInboxVisits(kv)).toEqual([visit("a", "tab-2", 3), visit("a", "tab-1", 1)])
  })

  test("drops malformed persisted entries instead of throwing", () => {
    expect(parseInboxVisits("nope")).toEqual([])
    expect(parseInboxVisits([{ taskId: "a" }, null, visit("b", null, 2)])).toEqual([visit("b", null, 2)])
    expect(readInboxVisits(fakeKv({ not: "an array" }))).toEqual([])
  })

  test("indexes by (task, tab), newest entry winning", () => {
    const index = inboxVisitIndex([visit("a", "tab-2", 5), visit("a", "tab-1", 1), visit("a", "tab-2", 4)])
    expect([...index.values()]).toEqual([visit("a", "tab-2", 5), visit("a", "tab-1", 1)])
    expect(index.get(inboxVisitKey(visit("a", "tab-2", 5)))).toEqual(visit("a", "tab-2", 5))
  })
})

describe("inbox visit log across windows", () => {
  const savedHome = process.env.ROVE_HOME_DIR
  afterEach(() => {
    if (savedHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
    else process.env.ROVE_HOME_DIR = savedHome
  })

  // Two windows both hydrated before either flushed: each window's copy of
  // the log lacks the other's visit, so a whole-key write drops it.
  test("keeps both windows' visits when they switch tabs inside one flush window", () => {
    process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-inbox-visits-"))
    const left = createKvCore()
    const right = createKvCore()
    writeInboxVisit(left, visit("a", "tab-1", 1))
    writeInboxVisit(right, visit("b", "tab-1", 2))
    expect(left.flush()).toBe(true)
    expect(right.flush()).toBe(true)

    const reopened = createKvCore()
    expect(readInboxVisits(reopened)).toEqual([visit("b", "tab-1", 2), visit("a", "tab-1", 1)])
    expect(readInboxVisits(right)).toEqual([visit("b", "tab-1", 2), visit("a", "tab-1", 1)])
  })
})
