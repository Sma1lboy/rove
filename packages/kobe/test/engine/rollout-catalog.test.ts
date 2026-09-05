import { mkdir, mkdtemp, rename, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  defaultHistoryDeps,
  findLatestRolloutForWorktree,
  findRolloutFile,
  listSessionIdsForWorktree,
} from "../../src/engine/codex-local/history"

const SID = "00000000-0000-0000-0000-000000000001"
const OTHER = "00000000-0000-0000-0000-000000000002"
const meta = (cwd: string) => `${JSON.stringify({ type: "session_meta", payload: { cwd } })}\n`
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "rove-catalog-"))
  const day = path.join(root, "2026", "01", "01")
  await mkdir(day, { recursive: true })
  const file = path.join(day, `rollout-2026-01-01T00-00-00-${SID}.jsonl`)
  await writeFile(file, meta("/one"))
  const counts = { readdir: 0, stat: 0, readHead: 0, readFile: 0, bytes: 0 }
  let active = 0
  let maxActive = 0
  const deps = {
    ...defaultHistoryDeps,
    sessionsDir: () => root,
    readdir: async (p: string) => {
      counts.readdir++
      return defaultHistoryDeps.readdir(p)
    },
    stat: async (p: string) => {
      counts.stat++
      return stat(p)
    },
    readHead: async (p: string) => {
      counts.readHead++
      active++
      maxActive = Math.max(active, maxActive)
      try {
        const raw = await defaultHistoryDeps.readHead!(p)
        counts.bytes += Buffer.byteLength(raw)
        return raw
      } finally {
        active--
      }
    },
    readFile: async (p: string) => {
      counts.readFile++
      return defaultHistoryDeps.readFile(p)
    },
  }
  return { root, day, file, deps, counts, maxActive: () => maxActive }
}

describe("Codex rollout catalog invalidation", () => {
  it("discovers new files inside an existing day without a root mtime change", async () => {
    const f = await fixture()
    expect(await listSessionIdsForWorktree("/one", f.deps)).toEqual([SID])
    const rootStamp = (await stat(f.root)).mtimeMs
    const other = path.join(f.day, `rollout-2026-01-01T00-00-01-${OTHER}.jsonl`)
    await writeFile(other, meta("/one"))
    expect((await stat(f.root)).mtimeMs).toBe(rootStamp)
    expect(await listSessionIdsForWorktree("/one", f.deps)).toEqual([SID, OTHER])
  })

  it("invalidates cwd on same-mtime rewrites, replacement and truncation", async () => {
    const f = await fixture()
    const stamp = await stat(f.file)
    expect(await listSessionIdsForWorktree("/one", f.deps)).toEqual([SID])
    await writeFile(f.file, meta("/two"))
    await utimes(f.file, stamp.atime, stamp.mtime)
    expect(await listSessionIdsForWorktree("/one", f.deps)).toEqual([])
    expect(await listSessionIdsForWorktree("/two", f.deps)).toEqual([SID])
    const replacement = path.join(f.root, "replacement")
    await writeFile(replacement, meta("/new"))
    await utimes(replacement, stamp.atime, stamp.mtime)
    await rename(replacement, f.file)
    expect(await listSessionIdsForWorktree("/two", f.deps)).toEqual([])
    expect(await listSessionIdsForWorktree("/new", f.deps)).toEqual([SID])
    await writeFile(f.file, "")
    expect(await listSessionIdsForWorktree("/new", f.deps)).toEqual([])
    await writeFile(f.file, meta("/new"))
    expect(await listSessionIdsForWorktree("/new", f.deps)).toEqual([SID])
  })

  it("revalidates a located file that vanished or moved to another day", async () => {
    const f = await fixture()
    expect(await findRolloutFile(SID, f.deps)).toBe(f.file)
    const day2 = path.join(f.root, "2026", "01", "02")
    await mkdir(day2)
    const moved = path.join(day2, path.basename(f.file))
    await rename(f.file, moved)
    expect(await findRolloutFile(SID, f.deps)).toBe(moved)
    await rename(moved, path.join(f.root, "outside-catalog"))
    expect(await findRolloutFile(SID, f.deps)).toBeUndefined()
  })

  it("isolates home changes even when the deps object is reused", async () => {
    const a = await fixture()
    const b = await fixture()
    await writeFile(b.file, meta("/two"))
    let root = a.root
    const deps = { ...a.deps, sessionsDir: () => root }
    expect(await findRolloutFile(SID, deps)).toBe(a.file)
    expect(await listSessionIdsForWorktree("/one", deps)).toEqual([SID])
    root = b.root
    expect(await findRolloutFile(SID, deps)).toBe(b.file)
    expect(await listSessionIdsForWorktree("/one", deps)).toEqual([])
    expect(await listSessionIdsForWorktree("/two", deps)).toEqual([SID])
  })

  it("shares one refresh across fifty concurrent worktrees and reuses unchanged headers", async () => {
    const f = await fixture()
    for (let n = 2; n <= 201; n++) {
      const id = `00000000-0000-0000-0000-${n.toString().padStart(12, "0")}`
      await writeFile(path.join(f.day, `rollout-2026-01-01T00-00-00-${id}.jsonl`), meta(`/wt/${n % 50}`))
    }
    await Promise.all(Array.from({ length: 50 }, (_, n) => findLatestRolloutForWorktree(`/wt/${n}`, f.deps)))
    expect(f.counts.readdir).toBe(4)
    expect(f.counts.stat).toBe(205)
    expect(f.counts.readHead).toBe(201)
    expect(f.counts.readFile).toBe(0)
    expect(f.maxActive()).toBeLessThanOrEqual(8)
    const cold = { ...f.counts }
    await Promise.all(Array.from({ length: 50 }, (_, n) => listSessionIdsForWorktree(`/wt/${n}`, f.deps)))
    expect(f.counts.readdir).toBe(cold.readdir)
    expect(f.counts.readHead).toBe(cold.readHead)
    expect(f.counts.stat - cold.stat).toBe(205)
    expect(f.counts.bytes).toBe(cold.bytes)
  })
})

it("retries a failed day listing even when its stat stamp stays unchanged", async () => {
  let dayReads = 0
  const deps = {
    ...defaultHistoryDeps,
    sessionsDir: () => "/r",
    stat: async () => ({ mtimeMs: 1, ctimeMs: 1, size: 1, ino: 1, dev: 1 }),
    readdir: async (p: string) => {
      if (p === "/r") return ["2026"]
      if (p === "/r/2026") return ["09"]
      if (p === "/r/2026/09") return ["04"]
      if (p === "/r/2026/09/04") {
        dayReads++
        if (dayReads === 1) throw new Error("transient IO")
        return [`rollout-2026-09-04T00-00-00-${SID}.jsonl`]
      }
      return []
    },
  }
  expect(await findRolloutFile(SID, deps)).toBeUndefined()
  expect(await findRolloutFile(SID, deps)).toContain(SID)
  expect(dayReads).toBe(2)
})
