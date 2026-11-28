import type { DaemonTask } from "@sma1lboy/rove-daemon/daemon/contracts"
import { type DiskReading, LOW_DISK_REPEAT_MS, createLowDiskCheck } from "@sma1lboy/rove-daemon/daemon/low-disk-watch"
import type { NoticeEventPayload } from "@sma1lboy/rove-daemon/daemon/protocol"
import { describe, expect, it } from "vitest"

const GIB = 1024 ** 3

function task(id: string, worktreePath: string, extra: Partial<DaemonTask> = {}): DaemonTask {
  return {
    id,
    title: id,
    repo: "/repo",
    branch: id,
    worktreePath,
    kind: "task",
    status: "backlog",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...extra,
  }
}

function harness(tasks: readonly DaemonTask[], disks: Record<string, DiskReading>) {
  const published: NoticeEventPayload[] = []
  const read: string[] = []
  let now = 1_000_000
  const check = createLowDiskCheck({
    listTasks: () => tasks,
    readDisk: async (path) => {
      read.push(path)
      return disks[path] ?? null
    },
    publish: (n) => published.push(n),
    now: () => now,
  })
  const advance = (ms: number): void => {
    now += ms
  }
  return { check, published, read, advance, disks }
}

describe("low-disk watch", () => {
  it("toasts once per low disk, counting the worktrees on it", async () => {
    const h = harness([task("a", "/vol1/a"), task("b", "/vol1/b"), task("c", "/vol2/c")], {
      "/vol1/a": { device: 1, freeBytes: 2 * GIB },
      "/vol1/b": { device: 1, freeBytes: 2 * GIB },
      "/vol2/c": { device: 2, freeBytes: 200 * GIB },
    })
    await h.check()
    expect(h.published).toHaveLength(1)
    expect(h.published[0]).toMatchObject({ kind: "needs_input", title: "Low disk space: 2.0 GB free" })
    expect(h.published[0]?.body).toContain("2 task worktrees are on this disk")
    expect(h.published[0]?.body).toContain("worktree-reclaim")
  })

  it("stays quiet while still low, reminds after the repeat window, and re-arms only after recovering", async () => {
    const h = harness([task("a", "/vol1/a")], { "/vol1/a": { device: 1, freeBytes: 3 * GIB } })
    await h.check()
    h.advance(60_000)
    await h.check()
    expect(h.published).toHaveLength(1)

    h.advance(LOW_DISK_REPEAT_MS)
    await h.check()
    expect(h.published).toHaveLength(2)

    // Hovering just above the line is not a recovery: no fresh toast on the next dip.
    h.disks["/vol1/a"] = { device: 1, freeBytes: 6 * GIB }
    await h.check()
    h.disks["/vol1/a"] = { device: 1, freeBytes: 4 * GIB }
    await h.check()
    expect(h.published).toHaveLength(2)

    h.disks["/vol1/a"] = { device: 1, freeBytes: 50 * GIB }
    await h.check()
    h.disks["/vol1/a"] = { device: 1, freeBytes: 1 * GIB }
    await h.check()
    expect(h.published).toHaveLength(3)
  })

  it("reads only worktrees Rove made, skipping borrowed directories and tasks being deleted", async () => {
    const h = harness(
      [
        task("own", "/vol1/own"),
        task("dir", "/home/me/proj", { kind: "dir" }),
        task("gone", "/vol1/gone", {
          deletion: { phase: "running", force: false, requestedAt: "2026-11-01T00:00:00.000Z" },
        }),
      ],
      {},
    )
    await h.check()
    expect(h.read).toEqual(["/vol1/own"])
    expect(h.published).toEqual([])
  })
})
