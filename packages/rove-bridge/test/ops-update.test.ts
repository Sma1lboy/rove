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
  })
  return { table, ranges, asked }
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

  test("release.notes refuses anything but x.y.z", async () => {
    const { table } = ops(null)
    await expect(table["release.notes"]?.run({ version: "../x" }, {} as never)).rejects.toMatchObject({
      code: "BAD_ARGS",
    })
  })
})
