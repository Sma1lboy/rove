import { describe, expect, test } from "bun:test"
import { TaskFeed } from "../src/feed.ts"
import type { TasksPayload } from "../src/protocol.ts"
import { type PtyListClient, SessionTitles } from "../src/session-titles.ts"

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
      const label = (await titles.current()).get("a::tab-1")
      return { tasks: [{ id: "a", label }], attention: [], gates: [] } as never
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
