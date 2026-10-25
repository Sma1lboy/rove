import { expect, test } from "bun:test"
import { tabRows } from "../src/rove-ops.ts"

const row = (extra: Record<string, unknown>) =>
  ({
    id: "tab-1",
    kind: "engine",
    title: null,
    vendor: "claude",
    liveVendor: null,
    lastTitle: null,
    autoTitle: null,
    alive: true,
    engineAlive: true,
    exit: null,
    ...extra,
  }) as never

test("an engine tab's conversation is the name the engine gave the session, never its bare product name", () => {
  const [named] = tabRows([row({ lastTitle: "Fix the login redirect" })])
  const [bare] = tabRows([row({ lastTitle: "Claude Code" })])
  const [renamed] = tabRows([row({ title: "My name", lastTitle: "Fix the login redirect" })])
  expect(named?.conversation).toBe("Fix the login redirect")
  expect(bare?.conversation).toBeNull()
  expect(renamed?.conversation).toBe("My name")
})

test("a shell tab has no conversation", () => {
  const [shell] = tabRows([row({ kind: "command", lastTitle: "vim" })])
  expect(shell?.conversation).toBeNull()
})
