/**
 * Low-disk watch: every attached UI gets one `notice.event` toast when a disk
 * holding task worktrees runs low, pointing at `worktree-reclaim`. Engines
 * fail in confusing ways on a full disk (half-written files, a crashed
 * install), so the warning has to arrive before the space is gone.
 *
 * One notice per disk (keyed by device id, so twenty worktrees on one volume
 * toast once), repeated at most every {@link LOW_DISK_REPEAT_MS} while still
 * low, and re-armed only once free space climbs past
 * {@link LOW_DISK_RECOVER_BYTES} so a disk hovering at the line never flaps.
 */

import fs from "node:fs/promises"
import { workspaceCapabilities } from "../workspace.ts"
import type { DaemonTask } from "./contracts.ts"
import type { NoticeEventPayload } from "./protocol.ts"
import { startTicker } from "./ticker.ts"
import { trackedWorktreePaths } from "./worktree-changes-collector.ts"

const GIB = 1024 ** 3
/** Below this much free space the disk counts as low. */
export const LOW_DISK_BYTES = 5 * GIB
/** A low disk re-arms only above this, so it never toasts on every wobble. */
export const LOW_DISK_RECOVER_BYTES = 8 * GIB
/** While a disk stays low, remind at most this often (a UI attached later still hears). */
export const LOW_DISK_REPEAT_MS = 6 * 60 * 60 * 1000
export const DEFAULT_LOW_DISK_TICK_MS = 5 * 60 * 1000

export interface DiskReading {
  /** Device id: worktrees on one volume share it. */
  readonly device: number
  readonly freeBytes: number
}

export interface LowDiskDeps {
  listTasks(): readonly DaemonTask[]
  /** `null` when the path is gone or unreadable. */
  readDisk(path: string): Promise<DiskReading | null>
  publish(notice: NoticeEventPayload): void
  now(): number
}

/** Free space available to this user on `path`'s volume. */
export async function readDisk(path: string): Promise<DiskReading | null> {
  try {
    const [st, fsInfo] = await Promise.all([fs.stat(path), fs.statfs(path)])
    return { device: st.dev, freeBytes: fsInfo.bavail * fsInfo.bsize }
  } catch {
    return null
  }
}

function formatGb(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} GB`
}

/** One pass per call; the returned function keeps the per-disk notice state. */
export function createLowDiskCheck(deps: LowDiskDeps): () => Promise<void> {
  const notifiedAt = new Map<number, number>()
  return async () => {
    // Only directories Rove made: those are what reclaim can free.
    const owned = deps.listTasks().filter((task) => !task.deletion && workspaceCapabilities(task).ownsDirectory)
    const disks = new Map<number, { freeBytes: number; worktrees: number }>()
    // Sequential on purpose: one slow mount must not fan out into many stuck stat calls.
    for (const path of trackedWorktreePaths(owned).keys()) {
      const reading = await deps.readDisk(path)
      if (!reading) continue
      const disk = disks.get(reading.device)
      if (disk) disk.worktrees++
      else disks.set(reading.device, { freeBytes: reading.freeBytes, worktrees: 1 })
    }
    const now = deps.now()
    for (const [device, disk] of disks) {
      if (disk.freeBytes >= LOW_DISK_RECOVER_BYTES) notifiedAt.delete(device)
      if (disk.freeBytes >= LOW_DISK_BYTES) continue
      const last = notifiedAt.get(device)
      if (last !== undefined && now - last < LOW_DISK_REPEAT_MS) continue
      notifiedAt.set(device, now)
      const count = disk.worktrees === 1 ? "1 task worktree is" : `${disk.worktrees} task worktrees are`
      deps.publish({
        title: `Low disk space: ${formatGb(disk.freeBytes)} free`,
        body: `${count} on this disk. \`rove api worktree-reclaim --merged --dry-run\` lists finished ones to free.`,
        kind: "needs_input",
        at: now,
        source: "low-disk",
      })
    }
  }
}

export function startLowDiskWatch(deps: LowDiskDeps, tickMs: number, gate: () => boolean): () => Promise<void> {
  return startTicker({ name: "low-disk", tickMs, gate, immediate: true, run: createLowDiskCheck(deps) })
}
