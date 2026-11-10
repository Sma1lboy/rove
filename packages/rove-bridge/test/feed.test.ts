import { expect, test } from "bun:test"
import { TaskFeed } from "../src/feed.ts"
import type { TasksPayload } from "../src/protocol.ts"

const rows = (id: string) => ({ tasks: [{ id }], attention: [], gates: [] }) as unknown as TasksPayload
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
  await sleep(5)
  expect(cheap.pushed).toEqual(["A"])
  cheap.state.payload = rows("B")
  cheap.feed.poke()
  await sleep(40)
  expect(cheap.pushed).toEqual(["A", "B"])

  // A 100 ms read earns a 400 ms rest, capped at 250: the bridge is not spent on reading.
  const slow = feedCosting(100)
  slow.feed.poke()
  await sleep(5)
  slow.state.payload = rows("B")
  slow.feed.poke()
  await sleep(120)
  expect(slow.pushed).toEqual(["A"])
  await sleep(160)
  expect(slow.pushed).toEqual(["A", "B"])
})

test("changes that arrive during the wait share one read", async () => {
  const { feed, state, pushed } = feedCosting(20)
  feed.poke()
  await sleep(5)
  for (const id of ["B", "C", "D"]) {
    state.payload = rows(id)
    feed.poke()
  }
  await sleep(120)
  expect(pushed).toEqual(["A", "D"])
})
