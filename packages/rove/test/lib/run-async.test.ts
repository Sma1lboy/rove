import { describe, expect, it } from "vitest"
import { runAsync } from "../../src/lib/run-async.ts"

describe("runAsync", () => {
  it("writes input to the child's stdin and closes it", async () => {
    const res = await runAsync(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], {
      input: "body & 'quotes'\nline two",
    })
    expect(res).toEqual({ ok: true, stdout: "body & 'quotes'\nline two", stderr: "" })
  })
})
