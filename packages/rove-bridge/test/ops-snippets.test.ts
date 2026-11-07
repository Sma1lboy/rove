import { describe, expect, test } from "bun:test"
import { type SnippetsDeps, createSnippetOps } from "../src/ops/snippets.ts"
import type { Args, BridgeApi, OpTable } from "../src/ops/types.ts"

type State = Record<string, unknown>

const api: BridgeApi = { verb: async () => ({}) as never, rpc: async () => ({}) as never }
const call = (table: OpTable, op: string, args: Args = {}) =>
  (table[op] as NonNullable<OpTable[string]>).run(args, { api })

function snippets(initial: State = {}) {
  const state: State = { ...initial }
  const deps: SnippetsDeps = {
    load: () => ({ ...state }),
    update: (compute) => {
      Object.assign(state, compute(state))
    },
  }
  return { state, ops: createSnippetOps(deps) }
}

const list = (r: unknown) => (r as { snippets: { name: string; text: string }[] }).snippets

describe("snippets", () => {
  test("saved snippets read back in order, and saving an existing name (any case) replaces it in place", async () => {
    const { ops } = snippets()
    await call(ops, "snippets.save", { name: "review", text: "Review this" })
    await call(ops, "snippets.save", { name: "tests", text: "Add tests" })
    const after = list(await call(ops, "snippets.save", { name: "Review", text: "Review it again" }))
    expect(after).toEqual([
      { name: "Review", text: "Review it again" },
      { name: "tests", text: "Add tests" },
    ])
    expect(list(await call(ops, "snippets.get"))).toEqual(after)
  })

  test("remove drops only that name", async () => {
    const { ops } = snippets()
    await call(ops, "snippets.save", { name: "a", text: "x" })
    await call(ops, "snippets.save", { name: "b", text: "y" })
    expect(list(await call(ops, "snippets.remove", { name: "A" }))).toEqual([{ name: "b", text: "y" }])
  })

  test("a name that could not be typed after @, or empty or oversized text, is refused", async () => {
    const { ops, state } = snippets()
    for (const args of [
      { name: "has space", text: "x" },
      { name: "-lead", text: "x" },
      { name: "a".repeat(33), text: "x" },
      { name: "ok", text: "   " },
      { name: "ok", text: "x".repeat(8001) },
    ]) {
      await expect(call(ops, "snippets.save", args)).rejects.toMatchObject({ code: "BAD_ARGS" })
    }
    expect(state["prompt.snippets"]).toBeUndefined()
  })

  test("the list is capped, but an existing name can still be edited at the cap", async () => {
    const { ops } = snippets()
    for (let i = 0; i < 100; i++) await call(ops, "snippets.save", { name: `s${i}`, text: "x" })
    await expect(call(ops, "snippets.save", { name: "extra", text: "x" })).rejects.toMatchObject({ code: "BAD_ARGS" })
    expect(list(await call(ops, "snippets.save", { name: "s5", text: "y" }))).toHaveLength(100)
  })

  test("hand-edited junk in state.json is skipped, not thrown on", async () => {
    const { ops } = snippets({
      "prompt.snippets": [null, 3, { name: "ok", text: "fine" }, { name: "bad name", text: "x" }],
    })
    expect(list(await call(ops, "snippets.get"))).toEqual([{ name: "ok", text: "fine" }])
  })
})
