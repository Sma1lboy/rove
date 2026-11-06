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
    liveTitle: null,
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

test("with no TUI open to record lastTitle, the live session title names the conversation, status prefix stripped", () => {
  const [live] = tabRows([row({ vendor: "omp", liveTitle: "π > 查询LayerFS作为Tasks后端进展" })])
  const [stale] = tabRows([row({ lastTitle: "old name", liveTitle: "Ungrouped 标题刷新问题" })])
  expect(live?.conversation).toBe("查询LayerFS作为Tasks后端进展")
  expect(stale?.conversation).toBe("Ungrouped 标题刷新问题")
})

test("a shell tab has no conversation", () => {
  const [shell] = tabRows([row({ kind: "command", lastTitle: "vim" })])
  expect(shell?.conversation).toBeNull()
})
