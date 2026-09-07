import { expect, it, vi } from "vitest"
const work = vi.hoisted(() => ({ hashed: 0 }))
vi.mock("node:crypto", async (importOriginal) => {
  const crypto = await importOriginal<typeof import("node:crypto")>()
  const track = (hash: import("node:crypto").Hash): import("node:crypto").Hash => {
    const proxy = new Proxy(hash, {
      get(target, key) {
        if (key === "update")
          return (data: string | Buffer) => {
            work.hashed += typeof data === "string" ? Buffer.byteLength(data) : data.byteLength
            target.update(data)
            return proxy
          }
        if (key === "copy") return () => track(target.copy())
        const value = Reflect.get(target, key)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    return proxy
  }
  return { ...crypto, createHash: (...args: Parameters<typeof crypto.createHash>) => track(crypto.createHash(...args)) }
})
import { parseSessionRaw } from "../../src/engine/claude-code-local/history-parse"
import { parseRolloutRaw } from "../../src/engine/codex-local/history-parse"
import { createAppendParseCache } from "../../src/engine/history-cache"

it("hashes each current prefix byte once during an append", () => {
  const parse = createAppendParseCache<string>({ initial: () => "", parseChunk: (chunk, prev) => prev + chunk })
  const prefix = `${"a".repeat(100_000)}\n`
  parse("/file", prefix, undefined)
  work.hashed = 0
  expect(parse("/file", `${prefix}b\n`, undefined)).toBe(`${prefix}b\n`)
  expect(work.hashed).toBe(Buffer.byteLength(`${prefix}b\n`))
})

it("invalidates parsed state when the context changes for the same path and bytes", () => {
  const parse = createAppendParseCache<string, string>({
    initial: (ctx) => ctx,
    parseChunk: (chunk, prev) => prev + chunk,
  })
  expect(parse("/ctx", "line\n", "first:")).toBe("first:line\n")
  expect(parse("/ctx", "line\n", "second:")).toBe("second:line\n")
})

it("keeps immutable Claude sorted snapshots across no-op polls and metadata appends", () => {
  const raw = `${JSON.stringify({ timestamp: "2026-01-01", message: { role: "user", content: "hi" } })}\n`
  const before = parseSessionRaw("/claude-sort", raw, "sid")
  expect(parseSessionRaw("/claude-sort", raw, "sid")).toBe(before)
  expect(parseSessionRaw("/claude-sort", `${raw}{"type":"progress"}\n`, "sid")).toBe(before)
})

it("keeps Codex messages across metadata-only appends", () => {
  const raw = `${JSON.stringify({ type: "response_item", timestamp: "2026-01-01", payload: { type: "message", role: "user", content: "hi" } })}\n`
  const before = parseRolloutRaw("/codex-meta", raw, "sid")
  const after = parseRolloutRaw("/codex-meta", `${raw}{"type":"turn_context"}\n`, "sid")
  expect(after.messages).toBe(before.messages)
})

it("preserves stable timestamp ties and existing snapshots after usage changes", () => {
  const message = (text: string) =>
    `${JSON.stringify({ type: "response_item", timestamp: "2026-01-01", payload: { type: "message", role: "assistant", content: text } })}\n`
  const raw = message("first") + message("second")
  const before = parseRolloutRaw("/codex-usage", raw, "sid")
  const usage = '{"type":"turn.completed","usage":{"output_tokens":9}}\n'
  const after = parseRolloutRaw("/codex-usage", raw + usage, "sid")
  expect(after.messages.map((m) => m.blocks)).toEqual([
    [{ type: "text", text: "first" }],
    [{ type: "text", text: "second" }],
  ])
  expect(before.messages[1]?.usage).toBeUndefined()
  expect(after.messages[1]?.usage?.output_tokens).toBe(9)
  expect(after.messages[0]).toBe(before.messages[0])
})

it("replaces the cached hash when a rewrite produces the same fold state", () => {
  let folds = 0
  const parse = createAppendParseCache<null>({
    initial: () => null,
    parseChunk: () => {
      folds++
      return null
    },
  })
  parse("/empty-fold", "aaa\n", undefined)
  parse("/empty-fold", "bbb\n", undefined)
  expect(folds).toBe(2)
  parse("/empty-fold", "bbb\n", undefined)
  expect(folds).toBe(2)
})
