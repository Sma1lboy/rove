/**
 * `PtyRegistry` — one PTY per key, decoupling shell lifecycle (per task)
 * from pane lifecycle (per render), so remounts keep scrollback and
 * in-flight commands. A dumb container: it doesn't watch task status
 * (callers `release()`), and there is no concurrency cap.
 *
 * Parking is automatic: the idle sweep detaches hidden tabs' emulators after
 * serializing the screen (`capturePark`, ~100-200KB); the wake feeds that
 * plus the host's exact byte delta since park (`pty.open sinceOffset`) —
 * bit-identical to never detaching, which a 512KB ring replay alone can't
 * do for a long session. A trimmed delta or respawned child degrades to
 * full replay + repaint wiggle.
 *
 * All methods are sync, so no intra-registry races. The app makes one
 * registry; each registry holds its own handles.
 */

import { isDev } from "../../../env.ts"
import { type ParkedScreen, type TaskPty, type TaskPtyOpts, createTaskPty } from "./pty"

export type AcquireOpts = Omit<TaskPtyOpts, "taskId" | "cwd">

/** Hidden (no data subscriber) for this long → park the local handle. */
const PARK_AFTER_MS = 120_000
/** Cadence of the park sweep. */
const PARK_SWEEP_MS = 30_000
/** Output within this window = ACTIVE, never parked (an active stream
 *  defeats the lossless wake, see `TaskPtyLike.lastOutputAtMs`). */
export const PARK_QUIET_MS = 30_000

/** Injectable so tests can use `MockTaskPty` without touching `process.env`. */
export type PtyFactory = (opts: TaskPtyOpts) => TaskPty

export class PtyRegistry {
  private readonly map = new Map<string, TaskPty>()
  /** Parked screens (~100-200KB vs a multi-MB live emulator), consumed by the
   *  next `acquire()` as `TaskPtyOpts.restore`. */
  private readonly parked = new Map<string, ParkedScreen>()
  private readonly factory: PtyFactory
  private sweepTimer: ReturnType<typeof setInterval> | null = null

  constructor(factory: PtyFactory = createTaskPty) {
    this.factory = factory
  }

  /** Started on first acquire so PTY-less registries run no timer; `unref`
   *  so it can't keep the process alive. */
  private ensureSweeper(): void {
    if (this.sweepTimer) return
    const timer = setInterval(() => this.parkIdle(PARK_AFTER_MS), PARK_SWEEP_MS)
    ;(timer as { unref?: () => void }).unref?.()
    this.sweepTimer = timer
  }

  private stopSweeper(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    this.sweepTimer = null
  }

  /**
   * Park every persistent-backend handle with no data subscriber for
   * `idleMs`+ (only the mounted pane subscribes, so unwatched == hidden tab).
   * Returns the parked keys.
   */
  parkIdle(idleMs: number, now: number = Date.now()): string[] {
    const parked: string[] = []
    for (const [id, pty] of this.map) {
      if (pty.killed) continue
      if (!pty.detach || !pty.unwatchedSinceMs) continue
      const since = pty.unwatchedSinceMs()
      if (since === null || now - since < idleMs) continue
      // A still-streaming child stays resident: its delta outruns the 512KB
      // ring and the degraded wake's wiggle coalesces ("input box gone").
      const lastOut = pty.lastOutputAtMs?.() ?? null
      if (lastOut !== null && now - lastOut < PARK_QUIET_MS) continue
      const screen = pty.capturePark?.() ?? null
      try {
        pty.detach({
          parked: screen !== null,
          parkedScreenBytes: screen ? Buffer.byteLength(screen.serialized) : undefined,
        })
      } catch {
        /* already dead — drop it either way */
      }
      this.map.delete(id)
      if (screen) this.parked.set(id, screen)
      parked.push(id)
    }
    if (parked.length > 0 && isDev()) {
      const rss = Math.round(process.memoryUsage().rss / (1024 * 1024))
      console.error(`[rove pty] parked ${parked.length} idle terminal(s); ${this.map.size} live; rss=${rss}MB`)
    }
    return parked
  }

  /**
   * The live PTY for `taskId`, or a new one in `cwd`. `cwd` only matters on
   * first acquire; a changed path needs `release()` + `acquire()`.
   */
  acquire(taskId: string, cwd: string, opts: AcquireOpts = {}): TaskPty {
    const existing = this.map.get(taskId)
    if (existing && !existing.killed) return existing
    if (existing) this.map.delete(taskId)

    // A parked screen rides along exactly once: restored or discarded.
    const restore = this.parked.get(taskId)
    if (restore) this.parked.delete(taskId)
    const pty = this.factory({ taskId, cwd, ...opts, ...(restore ? { restore } : {}) })
    this.map.set(taskId, pty)
    this.ensureSweeper()
    return pty
  }

  /** Look up an existing PTY without creating one. Returns null if absent. */
  get(taskId: string): TaskPty | null {
    const pty = this.map.get(taskId)
    if (!pty) return null
    if (pty.killed) {
      this.map.delete(taskId)
      return null
    }
    return pty
  }

  /** Whether a live PTY exists for this task id. */
  has(taskId: string): boolean {
    return this.get(taskId) !== null
  }

  /** Kill the PTY for `taskId` and forget it. No-op if absent. */
  release(taskId: string): void {
    const pty = this.map.get(taskId)
    this.map.delete(taskId)
    // Else the next session under this key would paint a dead one's past.
    this.parked.delete(taskId)
    if (!pty) return
    try {
      pty.kill()
    } catch {
      // Already dead. Idempotent — see `TaskPty.kill()` contract.
    }
  }

  /**
   * Kill and forget every PTY whose id matches — task-scoped teardown for
   * tab keys (`taskId::tabId`). Parked screens go too; the delete flow ends
   * their host sessions.
   */
  releaseWhere(predicate: (id: string) => boolean): void {
    const ids = Array.from(this.map.keys()).filter(predicate)
    for (const id of ids) this.release(id)
    for (const id of Array.from(this.parked.keys()).filter(predicate)) this.parked.delete(id)
  }

  /** Kill and forget every PTY. */
  releaseAll(): void {
    const ids = Array.from(this.map.keys())
    for (const id of ids) this.release(id)
    this.parked.clear()
    this.stopSweeper()
  }

  /** App exit: hosted sessions keep running and reattach next boot;
   *  backends without `detach()` are killed. */
  detachAll(): void {
    const ptys = Array.from(this.map.values())
    this.map.clear()
    this.parked.clear()
    this.stopSweeper()
    for (const pty of ptys) {
      try {
        if (pty.detach) pty.detach()
        else pty.kill()
      } catch {
        /* already dead */
      }
    }
  }

  /** Kill and respawn: scrollback wiped, in-flight processes killed. Shares
   *  release's cleanup so no old listener leaks. */
  reset(taskId: string, cwd: string, opts: AcquireOpts = {}): TaskPty {
    this.release(taskId)
    return this.acquire(taskId, cwd, opts)
  }

  /** Reset only while `expected` is still the live PTY registered for this key. */
  resetIfCurrent(taskId: string, expected: TaskPty, cwd: string, opts: AcquireOpts = {}): TaskPty | null {
    if (expected.killed || this.map.get(taskId) !== expected) return null
    return this.reset(taskId, cwd, opts)
  }

  /** Tests / debug: how many live PTYs are tracked. */
  get size(): number {
    return this.map.size
  }

  /** Every live PTY, keyed. The live-engine probe walks these shells'
   *  process trees to answer "which engine runs in this tab". */
  entries(): readonly (readonly [string, TaskPty])[] {
    return [...this.map]
  }
}

/** App-wide registry shared by every `<Terminal />`; tests pass `props.registry`. */
let defaultRegistry: PtyRegistry | null = null

export function getDefaultPtyRegistry(): PtyRegistry {
  if (!defaultRegistry) defaultRegistry = new PtyRegistry()
  return defaultRegistry
}

/** Tests: reset between cases so shells don't leak across tests. */
export function _resetDefaultPtyRegistry(): void {
  if (defaultRegistry) defaultRegistry.releaseAll()
  defaultRegistry = null
}
