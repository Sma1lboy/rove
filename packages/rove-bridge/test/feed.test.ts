import { expect, test } from "bun:test"
import { TaskFeed } from "../src/feed.ts"
import type { TasksPayload } from "../src/protocol.ts"

const rows = (id: string) => ({ tasks: [{ id }], attention: [], gates: [] }) as unknown as TasksPayload
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

test("the first change after a quiet spell is pushed at once; the next one inside the window waits", async () => {
  let payload = rows("A")
  let now = 1_000
  const feed = new TaskFeed(
    async () => payload,
    () => now,
  )
  const pushed: string[] = []
  feed.subscribe((p) => pushed.push(p.tasks[0]?.id ?? ""))

  feed.poke()
  await tick()
  expect(pushed).toEqual(["A"])

  payload = rows("B")
  feed.poke()
  await tick()
  expect(pushed).toEqual(["A"])

  await new Promise((resolve) => setTimeout(resolve, 260))
  expect(pushed).toEqual(["A", "B"])
  // Quiet again: the change shows without the wait.
  now += 300
  payload = rows("C")
  feed.poke()
  await tick()
  expect(pushed).toEqual(["A", "B", "C"])
})
