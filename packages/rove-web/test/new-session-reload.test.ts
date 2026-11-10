import { expect, test } from "bun:test"

test("the open composer is remembered for a reload, without a link's one-shot prompt", async () => {
  const kept = new Map<string, string>()
  Object.assign(globalThis, {
    sessionStorage: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    },
  })
  const { newSession, openNewSession } = await import("../src/ui.ts")

  openNewSession("/repo", undefined, undefined, "from a link")
  expect(JSON.parse(kept.get("rove.web.newSession") ?? "null")).toEqual({ repo: "/repo" })

  newSession.set(null)
  expect(kept.has("rove.web.newSession")).toBe(false)
})
