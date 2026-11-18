import { afterEach, beforeEach, expect, test } from "bun:test"

const savedSession = globalThis.sessionStorage
const kept = new Map<string, string>()
beforeEach(() => {
  kept.clear()
  Object.assign(globalThis, {
    sessionStorage: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    },
  })
})
afterEach(() => {
  Object.assign(globalThis, { sessionStorage: savedSession })
})

test("the open composer keeps its project and sky for a reload, without a link's one-shot prompt", async () => {
  const { newSession, openNewSession } = await import("../src/ui.ts")

  openNewSession("/repo", undefined, undefined, "from a link")
  expect(JSON.parse(kept.get("rove.web.newSession") ?? "null")).toEqual({ repo: "/repo", sky: "orbit" })

  newSession.set(null)
  expect(kept.has("rove.web.newSession")).toBe(false)
  openNewSession("/repo")
  expect(newSession.get()?.sky).toBe("comet")
  openNewSession("/repo")
  expect(newSession.get()?.sky).toBe("rings")
  openNewSession("/repo")
  expect(JSON.parse(kept.get("rove.web.newSession") ?? "null").sky).toBe("starlings")
  openNewSession("/repo")
  expect(newSession.get()?.sky).toBe("orbit")
  newSession.set(null)
})

test("the open page is remembered for a reload, and forgotten once closed", async () => {
  const { page } = await import("../src/ui.ts")

  page.set("routines")
  expect(JSON.parse(kept.get("rove.web.page") ?? "null")).toBe("routines")

  page.set(null)
  expect(kept.has("rove.web.page")).toBe(false)
})
