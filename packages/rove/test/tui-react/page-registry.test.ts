import { afterEach, describe, expect, it, vi } from "vitest"

// The registry's React hook is not under test; keep @opentui/react's Bun-only entry out of vitest.
vi.mock("../../src/tui-react/lib/use-accessor", () => ({ useAccessor: () => undefined }))

const { pageEntries, replacePageSources, setPageSource } = await import("../../src/tui-react/pages/registry")

const page = (id: string, order: number, action?: "kanban.open") => ({
  id,
  title: () => id,
  order,
  ...(action ? { action } : {}),
  component: () => null,
})

afterEach(() => {
  setPageSource("core", [])
  replacePageSources("plugin:", new Map())
})

describe("page registry", () => {
  it("orders the rail by `order`, and a chord two pages claim goes to the lower order", () => {
    setPageSource("core", [page("routines", 20), page("kanban", 10, "kanban.open")])
    replacePageSources("plugin:", new Map([["demo", [page("demo.board", 5, "kanban.open")]]]))

    expect(pageEntries().map((entry) => [entry.id, entry.action ?? null])).toEqual([
      ["demo.board", "kanban.open"],
      ["kanban", null],
      ["routines", null],
    ])
  })

  it("a plugin reload drops the pages of plugins no longer loaded", () => {
    replacePageSources(
      "plugin:",
      new Map([
        ["a", [page("a.x", 1)]],
        ["b", [page("b.y", 2)]],
      ]),
    )
    replacePageSources("plugin:", new Map([["b", [page("b.y", 2)]]]))
    expect(pageEntries().map((entry) => entry.id)).toEqual(["b.y"])
  })
})
