import { appendFile, mkdir, mkdtemp, rename, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

const io = vi.hoisted(() => ({ bytes: 0, reads: 0, fstats: 0, afterStat: async () => {} }))
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const file = await fs.open(...args)
      return new Proxy(file, {
        get(target, property) {
          if (property === "stat")
            return async () => {
              io.fstats++
              const result = await target.stat()
              await io.afterStat()
              return result
            }
          if (property === "read")
            return async (...args: Parameters<typeof file.read>) => {
              const result = await Reflect.apply(target.read, target, args)
              io.reads++
              io.bytes += result.bytesRead
              return result
            }
          const value = Reflect.get(target, property)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    },
  }
})
import { defaultHistoryDeps, findLatestRolloutForWorktree } from "../../src/engine/codex-local/history"
import { readFirstLineBounded, readTextFileBounded } from "../../src/engine/file-bounds"

afterEach(() => {
  io.afterStat = async () => {}
  io.bytes = 0
  io.reads = 0
  io.fstats = 0
})

it("bounds bytes when a file grows after its stat", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rove-growth-"))
  const file = path.join(dir, "file")
  await writeFile(file, "small")
  io.afterStat = async () => {
    await appendFile(file, "x".repeat(100))
  }
  expect(await readTextFileBounded(file, 32)).toBe("")
  expect(io.bytes).toBe(33)
})

it("reads the statted handle when the path is replaced", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rove-replacement-"))
  const file = path.join(dir, "file")
  const replacement = path.join(dir, "replacement")
  await writeFile(file, "original")
  await writeFile(replacement, "x".repeat(100))
  io.afterStat = async () => {
    await rename(replacement, file)
  }
  expect(await readTextFileBounded(file, 32)).toBe("original")
})

it("reads at most one buffer when a header precedes a large body", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rove-head-"))
  const file = path.join(dir, "file")
  await writeFile(file, `header\n${"x".repeat(1024 * 1024)}`)
  expect(await readFirstLineBounded(file)).toBe("header")
  expect(io.reads).toBe(1)
  expect(io.bytes).toBe(16 * 1024)
})

describe("real catalog byte budget", () => {
  it("cold discovery reads headers, warm parallel queries read zero bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rove-catalog-bytes-"))
    const day = path.join(root, "2026", "01", "01")
    await mkdir(day, { recursive: true })
    for (let n = 0; n < 201; n++) {
      const id = `00000000-0000-0000-0000-${n.toString().padStart(12, "0")}`
      await writeFile(
        path.join(day, `rollout-2026-01-01T00-00-00-${id}.jsonl`),
        `${JSON.stringify({ type: "session_meta", payload: { cwd: `/wt/${n % 50}` } })}\n${"x".repeat(32 * 1024)}`,
      )
    }
    const deps = { ...defaultHistoryDeps, sessionsDir: () => root }
    await Promise.all(Array.from({ length: 50 }, (_, n) => findLatestRolloutForWorktree(`/wt/${n}`, deps)))
    expect(io.bytes).toBe(201 * 16 * 1024)
    expect(io.reads).toBe(201)
    expect(io.fstats).toBe(201)
    io.bytes = 0
    io.reads = 0
    await Promise.all(Array.from({ length: 50 }, (_, n) => findLatestRolloutForWorktree(`/wt/${n}`, deps)))
    expect(io.bytes).toBe(0)
    expect(io.reads).toBe(0)
  })
})
