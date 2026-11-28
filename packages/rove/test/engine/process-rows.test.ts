import { foregroundEngineIn, parsePsSnapshot } from "@sma1lboy/rove-core/engine/foreground.ts"
import { serializeProcRows } from "@sma1lboy/rove-core/engine/process-rows.ts"
import { describe, expect, it } from "vitest"

describe("process row serialization", () => {
  it.each(["\n", "\r\n", "\r", "\u2028", "\u2029"])(
    "keeps %j inside arguments from changing process identity",
    (separator) => {
      const rows = parsePsSnapshot(
        serializeProcRows([
          { pid: 200, ppid: 100, args: `python3 worker.py hello${separator}300 100 claude` },
          { pid: 400, ppid: 101, args: `claude prompt${separator}500 101 codex` },
        ]),
      )

      expect(rows.map(({ pid, ppid }) => ({ pid, ppid }))).toEqual([
        { pid: 200, ppid: 100 },
        { pid: 400, ppid: 101 },
      ])
      expect(foregroundEngineIn(rows, 100)).toBeNull()
      expect(foregroundEngineIn(rows, 101)).toMatchObject({ vendor: "claude", pid: 400 })
    },
  )
})
