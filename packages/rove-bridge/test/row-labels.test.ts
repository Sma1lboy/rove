import { describe, expect, test } from "bun:test"
import type { SerializedTask } from "@sma1lboy/rove-daemon/daemon/protocol"
import { TaskFeed } from "../src/feed.ts"
import type { TasksPayload } from "../src/protocol.ts"
import { type RowTitleSources, rowLabels } from "../src/row-labels.ts"
import { type PtyListClient, SessionTitles } from "../src/session-titles.ts"

function task(id: string, extra: Partial<SerializedTask> = {}): SerializedTask {
  return {
    id,
    title: "Seeded prompt words",
    repo: "/work/app",
    branch: `b/${id}`,
    worktreePath: `/work/.rove/worktrees/${id}`,
    kind: "task",
    status: "in_progress",
    pinned: false,
    vendor: "claude",
    ...extra,
  } as SerializedTask
}

const engineTab = (id = "tab-1", extra: Record<string, unknown> = {}) => ({
  id,
  kind: "engine",
  vendor: "claude",
  ...extra,
})

function sources(
  tabs: Record<string, readonly Record<string, unknown>[]>,
  sessions: Record<string, string> = {},
): RowTitleSources {
  return {
    sessions: new Map(Object.entries(sessions)),
    tabs: (taskId) => (tabs[taskId] ? ({ tabs: tabs[taskId], activeId: "tab-1" } as never) : undefined),
  }
}

describe("rowLabels", () => {
  test("the live session title wins over the stored title, status prefix stripped", () => {
    const labels = rowLabels(
      [task("a"), task("b", { vendor: "omp" })],
      sources(
        { a: [engineTab()], b: [engineTab("tab-1", { vendor: "omp" })] },
        { "a::tab-1": "✳ Fix the login redirect", "b::tab-1": "π > 查询LayerFS进展" },
      ),
    )
    expect(labels.get("a")).toBe("Fix the login redirect")
    expect(labels.get("b")).toBe("查询LayerFS进展")
  })

  test("without a live title the recorded one names it, and a rename beats both", () => {
    const labels = rowLabels(
      [task("a"), task("b")],
      sources(
        {
          a: [engineTab("tab-1", { lastTitle: "Recorded name" })],
          b: [engineTab("tab-1", { title: "Mine", lastTitle: "x" })],
        },
        { "b::tab-1": "Live" },
      ),
    )
    expect(labels.get("a")).toBe("Recorded name")
    expect(labels.get("b")).toBe("Mine")
  })

  test("an unnamed or engine-product-named session falls back to the stored title; a shell never names the row", () => {
    const labels = rowLabels(
      [task("a"), task("b"), task("c")],
      sources(
        { a: [engineTab()], b: [engineTab()], c: [{ id: "tab-1", kind: "command" }] },
        { "b::tab-1": "✳ Claude Code", "c::tab-1": "vim" },
      ),
    )
    expect(labels.get("a")).toBe("Seeded prompt words")
    expect(labels.get("b")).toBe("Seeded prompt words")
    expect(labels.get("c")).toBe("Seeded prompt words")
  })

  test("a dir row is named by its conversation, else its path (never the generated title)", () => {
    const dir = task("d", { kind: "dir", title: "jacksonc-ab3x", branch: "", worktreePath: "/work/scratch" })
    expect(rowLabels([dir], sources({ d: [engineTab()] }, { "d::tab-1": "Fix it" })).get("d")).toBe("Fix it")
    expect(rowLabels([dir], sources({})).get("d")).toBe("/work/scratch")
  })

  test("a migrated child reads the parent's aliased tab", () => {
    const child = task("c", { ptyAlias: { taskId: "p", tabId: "tab-2" } } as never)
    const labels = rowLabels(
      [task("p"), child],
      sources({ p: [engineTab("tab-1"), engineTab("tab-2")] }, { "p::tab-1": "Parent chat", "p::tab-2": "Second" }),
    )
    expect(labels.get("c")).toBe("Second")
    expect(labels.get("p")).toBe("Parent chat")
  })

  test("no sources at all reads the stored title", () => {
    expect(rowLabels([task("a")], null).get("a")).toBe("Seeded prompt words")
  })
})

describe("SessionTitles", () => {
  function host(initial: Record<string, string>) {
    const state = { sessions: initial, closed: 0, lists: 0 }
    const client: PtyListClient = {
      request: (async () => {
        state.lists++
        return { sessions: Object.entries(state.sessions).map(([key, title]) => ({ key, alive: true, title })) }
      }) as never,
      close: () => {
        state.closed++
      },
    }
    return { state, client }
  }

  test("a retitle moves the signature and re-pushes the feed; an unchanged title does neither", async () => {
    const { state, client } = host({ "a::tab-1": "First name" })
    const titles = new SessionTitles(() => client)
    const pushes: TasksPayload[] = []
    const feed = new TaskFeed(async () => {
      const labels = rowLabels([task("a")], sources({ a: [engineTab()] }, Object.fromEntries(await titles.current())))
      return { tasks: [{ id: "a", label: labels.get("a") }], attention: [], gates: [] } as never
    })
    feed.subscribe((payload) => pushes.push(payload))
    expect(feed.active).toBe(true)
    // What `watch` does on each interval while a client listens: poll, and refresh the feed when a title moved.
    const tick = async () => (await titles.tick()) && (await feed.refresh())
    await feed.refresh()
    await tick()
    expect(pushes.map((p) => p.tasks[0]?.label)).toEqual(["First name"])
    state.sessions = { "a::tab-1": "Second name" }
    await tick()
    expect(pushes.map((p) => p.tasks[0]?.label)).toEqual(["First name", "Second name"])
    await tick()
    expect(pushes).toHaveLength(2)
  })

  test("a host that is gone reads as no titles and is reconnected on the next poll", async () => {
    let up = false
    let opened = 0
    const titles = new SessionTitles(
      () => {
        opened++
        return {
          request: (async () =>
            up
              ? { sessions: [{ key: "a::tab-1", alive: true, title: "Back" }] }
              : Promise.reject(new Error("ECONNREFUSED"))) as never,
          close: () => {},
        }
      },
      (() => {
        let t = 0
        return () => {
          t += 10_000
          return t
        }
      })(),
    )
    expect((await titles.current()).size).toBe(0)
    up = true
    expect((await titles.current()).get("a::tab-1")).toBe("Back")
    expect(opened).toBe(2)
  })

  test("a session that set no title, or is dead, names nothing", async () => {
    const client: PtyListClient = {
      request: (async () => ({
        sessions: [
          { key: "a::tab-1", alive: true, title: "" },
          { key: "b::tab-1", alive: false, title: "Gone" },
        ],
      })) as never,
      close: () => {},
    }
    expect((await new SessionTitles(() => client).current()).size).toBe(0)
  })
})
