import { describe, expect, test } from "bun:test"
import { createUpdateOps } from "../src/ops/update.ts"

const notes = { version: "1.1.0", url: "u", body: "b" }

function ops(info: { current: string; latest: string; hasUpdate: boolean; channel: "latest" } | null) {
  const ranges: [string, string][] = []
  const table = createUpdateOps({
    current: "1.0.0",
    check: async () => info,
    notesRange: async (c, l) => {
      ranges.push([c, l])
      return [notes]
    },
    notes: async () => notes,
  })
  return { table, ranges }
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

  test("release.notes refuses anything but x.y.z", async () => {
    const { table } = ops(null)
    await expect(table["release.notes"]?.run({ version: "../x" }, {} as never)).rejects.toMatchObject({
      code: "BAD_ARGS",
    })
  })
})
