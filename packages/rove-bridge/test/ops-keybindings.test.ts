import { describe, expect, test } from "bun:test"
import { type KeybindingsDeps, createKeybindingsOps } from "../src/ops/keybindings.ts"
import type { OpTable } from "../src/ops/types.ts"
import { fakeApi } from "./task-ops-harness.ts"

const FILE = "/home/me/.rove/settings/keybindings.yaml"

interface Got {
  readonly path: string
  readonly exists: boolean
  readonly rows: ReadonlyArray<{ id: string; keys: string[]; prefixKeys?: string[] }>
  readonly prefix: { key: string | null; firstStrokes: string[]; timeoutMs: number }
  readonly plugins: unknown[]
  readonly warnings: string[]
}

function ops(doc: unknown, over: Partial<KeybindingsDeps> = {}): OpTable {
  return createKeybindingsOps({
    read: () => ({ path: FILE, exists: doc !== undefined, doc: doc ?? null, warnings: [] }),
    create: () => true,
    fireAction: () => true,
    platform: "linux",
    ...over,
  })
}

async function run(table: OpTable, op: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const spec = table[op]
  if (!spec) throw new Error(`no op ${op}`)
  return spec.run(args, { api: fakeApi().api })
}

const get = async (doc: unknown) => (await run(ops(doc), "keybindings.get")) as Got

/** A dep that records what it was handed and says it worked. */
function recorder() {
  const seen: string[] = []
  return {
    seen,
    fn: (value: string) => {
      seen.push(value)
      return true
    },
  }
}

describe("keybindings.get", () => {
  test("no file is the plain defaults: nothing overridden, the default prefix", async () => {
    const got = await get(undefined)
    expect(got).toMatchObject({ path: FILE, exists: false, rows: [], plugins: [], warnings: [] })
    expect(got.prefix).toEqual({ key: "ctrl+a", firstStrokes: ["ctrl+a"], timeoutMs: 5000 })
  })

  test("carries the TUI parser's result: a direct chord, a prefix stroke, the prefix key and a plugin chord", async () => {
    const got = await get({
      bindings: { "chat.fork.new": "ctrl+g" },
      prefix: { key: "ctrl+b", timeoutMs: 2000, bindings: { "chat.tab.fork": "t" } },
      plugins: { "ctrl+k": "action:acme.notify.ping", f6: "pane:acme.git.main" },
    })
    const row = (id: string) => got.rows.find((r) => r.id === id)
    expect(row("chat.fork.new")?.keys).toEqual(["ctrl+g"])
    expect(row("chat.tab.fork")?.prefixKeys).toEqual(["t"])
    expect(got.prefix).toEqual({ key: "ctrl+b", firstStrokes: ["ctrl+b"], timeoutMs: 2000 })
    expect(got.plugins).toEqual([
      { chord: "ctrl+k", kind: "action", target: "acme.notify.ping" },
      { chord: "f6", kind: "pane", target: "acme.git.main" },
    ])
  })

  test("only rows the file changed are listed, and a bad entry is a warning, not a failure", async () => {
    const got = await get({ bindings: { "chat.fork.new": "ctrl+g", "no.such.id": "x" } })
    expect(got.rows.map((r) => r.id)).toEqual(["chat.fork.new"])
    expect(got.warnings.join("\n")).toContain("no.such.id")
  })

  test("the prefix can be switched off", async () => {
    expect((await get({ prefix: { key: null } })).prefix).toEqual({ key: null, firstStrokes: [], timeoutMs: 5000 })
  })
})

describe("keybindings.createFile", () => {
  test("writes the starter where the TUI does and says it created it", async () => {
    const made = recorder()
    const table = ops(undefined, { create: made.fn })
    expect(await run(table, "keybindings.createFile")).toEqual({ path: FILE, created: true })
    expect(made.seen).toEqual([FILE])
  })

  test("an existing file is never touched", async () => {
    const made = recorder()
    const table = ops({}, { create: made.fn })
    expect(await run(table, "keybindings.createFile")).toEqual({ path: FILE, created: false })
    expect(made.seen).toEqual([])
  })
})

describe("plugin.chordAction", () => {
  const doc = { plugins: { "ctrl+k": "action:acme.notify.ping", f6: "pane:acme.git.main" } }

  test("fires the action the Mac's own YAML binds to the chord", async () => {
    const fired = recorder()
    const table = ops(doc, { fireAction: fired.fn })
    expect(await run(table, "plugin.chordAction", { chord: "ctrl+k" })).toEqual({ target: "acme.notify.ping" })
    expect(fired.seen).toEqual(["acme.notify.ping"])
  })

  test("a chord the file does not bind, or binds to a pane, fires nothing", async () => {
    const fired = recorder()
    const table = ops(doc, { fireAction: fired.fn })
    for (const chord of ["ctrl+j", "f6"]) {
      await expect(run(table, "plugin.chordAction", { chord })).rejects.toMatchObject({ code: "NOT_BOUND" })
    }
    expect(fired.seen).toEqual([])
  })
})
