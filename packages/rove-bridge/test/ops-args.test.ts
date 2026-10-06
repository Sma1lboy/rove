import { describe, expect, test } from "bun:test"
import { parseFlags } from "@sma1lboy/rove/src/cli/api/flags.ts"
import { flag, oneOf, tabId, taskId, text } from "../src/ops/args.ts"
import { mergeOpTables } from "../src/ops/index.ts"
import type { OpSpec } from "../src/ops/types.ts"

describe("area op arguments", () => {
  test("a phone-supplied value that looks like a flag stays a value in the verb's argv", () => {
    const { flags } = parseFlags([flag("title", "--force"), flag("prompt", "a=b --delete-branch")])
    expect(flags.get("title")).toBe("--force")
    expect(flags.get("prompt")).toBe("a=b --delete-branch")
    expect(flags.has("force")).toBe(false)
  })

  test("ids and closed sets refuse anything else", () => {
    expect(taskId({ taskId: "01M4756MVZKGC84R07M659BEJW" })).toBe("01M4756MVZKGC84R07M659BEJW")
    expect(() => taskId({ taskId: "--force" })).toThrow("not a task id")
    expect(() => tabId({ tabId: "tab-1; rm -rf" })).toThrow("not a tab id")
    expect(oneOf({ s: "done" }, "s", ["open", "done"] as const)).toBe("done")
    expect(() => oneOf({ s: "shipped" }, "s", ["open", "done"] as const)).toThrow("open|done")
    expect(() => text({ body: "x".repeat(11) }, "body", 10)).toThrow("longer than 10")
  })

  test("an op registered twice is refused at startup", () => {
    const spec: OpSpec = { kind: "read", destructive: false, wraps: "test", run: async () => ({}) }
    expect(() => mergeOpTables({ "a.b": spec }, { "a.b": spec })).toThrow("registered twice")
  })
})
