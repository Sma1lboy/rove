import { runAsync } from "@sma1lboy/rove-core/lib/run-async.ts"
import { describe, expect, it } from "vitest"

describe("runAsync", () => {
  it("writes input to the child's stdin and closes it", async () => {
    const res = await runAsync(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], {
      input: "body & 'quotes'\nline two",
    })
    expect(res).toEqual({ ok: true, stdout: "body & 'quotes'\nline two", stderr: "" })
  })
})
