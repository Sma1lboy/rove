import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  readTextFileIfRegular,
  readTextFileIfRegularSync,
  readTextFileSyncBounded,
} from "../../src/engine/file-bounds.ts"

function fixture(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rove-strict-sync-"))
}

describe("strict synchronous file reads", () => {
  it("distinguishes missing, empty, exact byte limit and refusal", async () => {
    const dir = fixture()
    const file = path.join(dir, "config")
    expect(() => readTextFileIfRegularSync(file, 4)).toThrow()
    expect(readTextFileSyncBounded(file, 4)).toBeNull()
    fs.writeFileSync(file, "")
    expect(readTextFileIfRegularSync(file, 4)).toBe("")
    fs.writeFileSync(file, "éé")
    expect(readTextFileIfRegularSync(file, 4)).toBe("éé")
    expect(readTextFileIfRegularSync(file, 3)).toBeNull()
    expect(readTextFileIfRegularSync(file, 4)).toBe(await readTextFileIfRegular(file, 4))
    expect(readTextFileIfRegularSync(dir, 4)).toBeNull()
  })

  it("propagates permission failures while keeping credential fallback unchanged", () => {
    const file = path.join(fixture(), "unreadable")
    fs.writeFileSync(file, "secret fixture", { mode: 0 })
    try {
      if (process.getuid?.() !== 0) {
        expect(() => readTextFileIfRegularSync(file)).toThrow()
        expect(() => readTextFileSyncBounded(file)).toThrow()
      }
    } finally {
      fs.chmodSync(file, 0o600)
    }
  })

  it("rejects FIFOs without blocking, using the same open-handle checks as async", () => {
    const dir = fixture()
    const fifo = path.join(dir, "fifo")
    expect(spawnSync("mkfifo", [fifo]).status).toBe(0)
    const source = new URL("../../src/engine/file-bounds.ts", import.meta.url).pathname
    const child = spawnSync(
      "bun",
      [
        "-e",
        `
      import { homedir } from 'node:os';
      if (homedir() !== process.env.FIXTURE_HOME) throw Error('unsafe home');
      const { readTextFileIfRegularSync } = await import(${JSON.stringify(source)});
      if (readTextFileIfRegularSync(${JSON.stringify(fifo)}) !== null) throw Error('expected refusal');
    `,
      ],
      { env: { ...process.env, HOME: dir, FIXTURE_HOME: dir }, timeout: 3_000, encoding: "utf8" },
    )
    expect(child.error).toBeUndefined()
    expect(child.status, child.stderr).toBe(0)
    expect(fs.lstatSync(fifo).isFIFO()).toBe(true)
  })
})
