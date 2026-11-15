import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { makePrRefreshReader } from "@sma1lboy/rove-daemon/daemon/pr-refresh-setting"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

let dir: string
let file: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rove-pr-refresh-"))
  file = path.join(dir, "state.json")
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function write(text: string, mtimeSec: number): void {
  fs.writeFileSync(file, text)
  fs.utimesSync(file, mtimeSec, mtimeSec)
}

const withValue = (value: unknown): string => JSON.stringify({ theme: "x", "pr.refreshSeconds": value })

describe("pr.refreshSeconds", () => {
  test("a hand edit is picked up on the next read, 0 included", () => {
    const read = makePrRefreshReader(() => file)
    expect(read()).toBeUndefined()
    write(withValue(120), 1_000)
    expect(read()).toBe(120_000)
    write(withValue(0), 2_000)
    expect(read()).toBe(0)
  })

  test.each([
    ["below the tick", withValue(10)],
    ["above an hour", withValue(7200)],
    ["fractional", withValue(45.5)],
    ["a string", withValue("60")],
    ["invalid JSON", "{not json"],
  ])("%s falls back to the default", (_label, text) => {
    const read = makePrRefreshReader(() => file)
    write(withValue(120), 1_000)
    expect(read()).toBe(120_000)
    write(text, 2_000)
    expect(read()).toBeUndefined()
  })
})
