import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readTextFileBounded, readTextFileSyncBounded } from "../../src/engine/file-bounds.ts"

describe("file-bounds", () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kobe-file-bounds-"))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  describe("readTextFileBounded (async)", () => {
    it("degrades an oversize file to '' instead of slurping it", async () => {
      const p = join(dir, "big.jsonl")
      await writeFile(p, "x".repeat(64))
      // 64 bytes on disk, 16-byte ceiling → degraded, not loaded.
      expect(await readTextFileBounded(p, 16)).toBe("")
    })

    it("propagates ENOENT so the caller can degrade (matches existing catch paths)", async () => {
      await expect(readTextFileBounded(join(dir, "nope.jsonl"))).rejects.toMatchObject({ code: "ENOENT" })
    })
  })

  describe("readTextFileSyncBounded (credentials)", () => {
    it("returns null (the 'not detected' shape) for an oversize file — never throws, never logs", async () => {
      const p = join(dir, "fat.json")
      await writeFile(p, "y".repeat(100))
      expect(readTextFileSyncBounded(p, 10)).toBeNull()
    })
  })
})
