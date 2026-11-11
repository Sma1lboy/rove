import { describe, expect, test } from "bun:test"
import { createUpdateOps } from "../src/ops/update.ts"

const notes = { version: "1.1.0", url: "u", body: "b" }

function ops(info: { current: string; latest: string; hasUpdate: boolean; channel: "latest" } | null) {
  const ranges: [string, string][] = []
  const asked: (string | null)[] = []
  const table = createUpdateOps({
    current: "1.0.0",
    check: async (_force, channel) => {
      asked.push(channel)
      return info
    },
    notesRange: async (c, l) => {
      ranges.push([c, l])
      return [notes]
    },
    notes: async () => notes,
    install: () => ({ display: "sh update.sh" }),
    restart: () => {},
  })
  return { table, ranges, asked }
}

function installer() {
  let restarts = 0
  const runs: { output: (chunk: string) => void; exit: (code: number) => void }[] = []
  const table = createUpdateOps({
    current: "1.0.0",
    check: async () => null,
    notesRange: async () => [],
    notes: async () => null,
    install: (output, exit) => {
      runs.push({ output, exit })
      return { display: "sh update.sh" }
    },
    restart: () => {
      restarts++
    },
  })
  const status = async () => (await table["update.status"]?.run({}, {} as never)) as { status: unknown }
  return { table, runs, status, restarts: () => restarts }
}

describe("update ops", () => {
  test("notes are fetched only for a forward update; a failed check stays null, not up to date", async () => {
    const up = ops({ current: "1.0.0", latest: "1.1.0", hasUpdate: true, channel: "latest" })
    expect(await up.table["update.check"]?.run({}, {} as never)).toEqual({
      current: "1.0.0",
      info: { current: "1.0.0", latest: "1.1.0", hasUpdate: true, channel: "latest" },
      notes: [notes],
    })
    const none = ops(null)
    expect(await none.table["update.check"]?.run({}, {} as never)).toEqual({ current: "1.0.0", info: null, notes: [] })
    expect(none.ranges).toEqual([])
  })

  test("an explicit channel reaches the check; an unknown one falls back to the stored preference", async () => {
    const { table, asked } = ops(null)
    await table["update.check"]?.run({ channel: "next" }, {} as never)
    await table["update.check"]?.run({ channel: "beta" }, {} as never)
    await table["update.check"]?.run({}, {} as never)
    expect(asked).toEqual(["next", null, null])
  })

  test("update.run starts one installer at a time and reports its exit code", async () => {
    const { table, runs, status } = installer()
    expect((await status()).status).toBeNull()
    await table["update.run"]?.run({}, {} as never)
    await expect(table["update.run"]?.run({}, {} as never)).rejects.toMatchObject({ code: "BUSY" })
    expect(runs).toHaveLength(1)
    runs[0]?.output("added 1 package\n")
    expect((await status()).status).toEqual({
      running: true,
      command: "sh update.sh",
      code: null,
      output: "added 1 package\n",
    })
    runs[0]?.exit(1)
    // `error` then `close`: the first code stands.
    runs[0]?.exit(0)
    expect((await status()).status).toMatchObject({ running: false, code: 1 })
    await table["update.run"]?.run({}, {} as never)
    expect(runs).toHaveLength(2)
    expect((await status()).status).toMatchObject({ running: true, output: "" })
  })

  test("update.restart waits for a running installer", async () => {
    const { table, runs, restarts } = installer()
    await table["update.run"]?.run({}, {} as never)
    await expect(table["update.restart"]?.run({}, {} as never)).rejects.toMatchObject({ code: "BUSY" })
    runs[0]?.exit(0)
    await table["update.restart"]?.run({}, {} as never)
    expect(restarts()).toBe(1)
  })

  test("release.notes refuses anything but x.y.z", async () => {
    const { table } = ops(null)
    await expect(table["release.notes"]?.run({ version: "../x" }, {} as never)).rejects.toMatchObject({
      code: "BAD_ARGS",
    })
  })
})
