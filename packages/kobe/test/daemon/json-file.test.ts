import { mkdtemp, readFile, readdir, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { writeJsonAtomic } from "../../../kobe-daemon/src/daemon/json-file.ts"

describe("writeJsonAtomic", () => {
  it("creates parent dirs, writes pretty JSON with trailing newline, leaves no tmp", async () => {
    const dir = await mkdtemp(join(tmpdir(), "json-file-"))
    const path = join(dir, "nested", "store.json")
    await writeJsonAtomic(path, { version: 1, items: [1] })
    expect(await readFile(path, "utf8")).toBe('{\n  "version": 1,\n  "items": [\n    1\n  ]\n}\n')
    expect(await readdir(join(dir, "nested"))).toEqual(["store.json"])
  })

  it("honours compact + mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "json-file-"))
    const path = join(dir, "turns.json")
    await writeJsonAtomic(path, { a: 1 }, { compact: true, mode: 0o600 })
    expect(await readFile(path, "utf8")).toBe('{"a":1}\n')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
})
