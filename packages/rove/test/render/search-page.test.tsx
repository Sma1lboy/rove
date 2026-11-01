/** @jsxImportSource @opentui/react */
/**
 * The rail's Search page: a hit opens its task on the tab whose conversation said it, and the page's text
 * field keeps every key (`q` included) instead of closing the page.
 */
import { expect, it, mock } from "bun:test"
import type { SearchResult } from "../../src/engine/session-search"
import { SearchPage } from "../../src/tui-react/component/search-page"
import { act, renderComponent, settle } from "./harness"

const result: SearchResult = {
  query: "restart path",
  matches: [
    {
      taskId: "T1",
      title: "Audit the daemon's restart path",
      tabId: "tab-2",
      role: "user",
      at: new Date().toISOString(),
      snippet: "Create NOTES.md with one line 'restart path audit'",
    },
  ],
  skipped: [],
  truncated: false,
}
const searched: string[] = []
mock.module("../../src/engine/session-search", () => ({
  searchTasks: async (_tasks: unknown, query: string) => {
    searched.push(query)
    return { ...result, query }
  },
}))

const orchestrator = { listTasks: () => [] } as never

it("finds what was said and opens that task on the tab that said it", async () => {
  const opened: Array<[string, string | undefined]> = []
  let closed = 0
  const r = await renderComponent(
    <SearchPage
      orchestrator={orchestrator}
      focused
      debounceMs={0}
      onClose={() => closed++}
      onOpenTask={(taskId, tabId) => opened.push([taskId, tabId])}
    />,
  )
  await act(async () => {
    r.mockInput.typeText("restart path q")
    await settle()
  })
  await act(async () => settle())
  // `q` went into the field, not to a page-close binding.
  expect(closed).toBe(0)
  expect(searched.at(-1)).toBe("restart path q")
  const frame = await r.frame()
  expect(frame).toContain("Audit the daemon's restart path")
  expect(frame).toContain("restart path audit")
  await act(async () => {
    r.mockInput.pressEnter()
    await settle()
  })
  expect(opened).toEqual([["T1", "tab-2"]])
  r.destroy()
})
