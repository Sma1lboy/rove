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

test("the open composer is remembered for a reload, without a link's one-shot prompt", async () => {
  const { newSession, openNewSession } = await import("../src/ui.ts")

  openNewSession("/repo", undefined, undefined, "from a link")
  expect(JSON.parse(kept.get("rove.web.newSession") ?? "null")).toEqual({ repo: "/repo" })

  newSession.set(null)
  expect(kept.has("rove.web.newSession")).toBe(false)
})

test("the open page is remembered for a reload, and forgotten once closed", async () => {
  const { page } = await import("../src/ui.ts")

  page.set("routines")
  expect(JSON.parse(kept.get("rove.web.page") ?? "null")).toBe("routines")

  page.set(null)
  expect(kept.has("rove.web.page")).toBe(false)
})
