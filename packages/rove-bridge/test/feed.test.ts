import { afterEach, beforeEach, expect, jest, test } from "bun:test"
import { TaskFeed } from "../src/feed.ts"
import type { TasksPayload } from "../src/protocol.ts"

const rows = (id: string) => ({ tasks: [{ id }], attention: [], gates: [] }) as unknown as TasksPayload
/** Let a fired timer's read and its push run. */
const settle = () => Promise.resolve().then().then().then()

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

async function advance(ms: number) {
  jest.advanceTimersByTime(ms)
  await settle()
}

/** A feed whose read takes `cost` ms on a clock the test moves. */
function feedCosting(cost: number) {
  const clock = { now: 1_000 }
  const state = { payload: rows("A") }
  const feed = new TaskFeed(
    async () => {
      clock.now += cost
      return state.payload
    },
    () => clock.now,
  )
  const pushed: string[] = []
  feed.subscribe((p) => pushed.push(p.tasks[0]?.id ?? ""))
  return { feed, clock, state, pushed }
}

test("a change waits in proportion to what a read costs, not a fixed time", async () => {
  // A 2 ms read: the next change is on screen 8 ms later, where a fixed window held it 250 ms.
  const cheap = feedCosting(2)
  cheap.feed.poke()
  await advance(0)
  expect(cheap.pushed).toEqual(["A"])
  cheap.state.payload = rows("B")
  cheap.feed.poke()
  await advance(7)
  expect(cheap.pushed).toEqual(["A"])
  await advance(1)
  expect(cheap.pushed).toEqual(["A", "B"])

  // A 100 ms read earns a 400 ms rest, capped at 250: the bridge is not spent on reading.
  const slow = feedCosting(100)
  slow.feed.poke()
  await advance(0)
  slow.state.payload = rows("B")
  slow.feed.poke()
  await advance(249)
  expect(slow.pushed).toEqual(["A"])
  await advance(1)
  expect(slow.pushed).toEqual(["A", "B"])
})

test("changes that arrive during the wait share one read", async () => {
  const { feed, state, pushed } = feedCosting(20)
  feed.poke()
  await advance(0)
  state.payload = rows("B")
  feed.poke()
  state.payload = rows("C")
  feed.poke()
  state.payload = rows("D")
  feed.poke()
  await advance(80)
  expect(pushed).toEqual(["A", "D"])
})
