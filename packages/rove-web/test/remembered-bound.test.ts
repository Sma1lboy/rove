import { expect, test } from "bun:test"
import type { BridgeClient } from "../src/bridge.ts"
import { lastReply, remember } from "../src/remembered.ts"

test("the reply cache keeps the newest 200 and drops the oldest", () => {
  const client = {} as BridgeClient
  for (let i = 0; i < 201; i++) remember(client, "diff.file", { path: `p${i}` }, i)
  expect(lastReply<number>(client, "diff.file", { path: "p0" })).toBeUndefined()
  expect(lastReply<number>(client, "diff.file", { path: "p1" })).toBe(1)
  expect(lastReply<number>(client, "diff.file", { path: "p200" })).toBe(200)
  // A re-read refreshes an entry instead of letting it age out.
  remember(client, "diff.file", { path: "p1" }, 1)
  remember(client, "diff.file", { path: "p201" }, 201)
  expect(lastReply<number>(client, "diff.file", { path: "p1" })).toBe(1)
  expect(lastReply<number>(client, "diff.file", { path: "p2" })).toBeUndefined()
})
