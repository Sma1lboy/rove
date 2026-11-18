/**
 * file-watch-trigger (shared file-change trigger backing the ui-prefs,
 * keybindings, and pty-exit fan-outs). Why these tests matter: this module is
 * the load-bearing half of "edit a file on disk → daemon refreshes the
 * channel". The internals are a stat-poll (macOS FSEvents arms
 * asynchronously and permanently drops writes landing in the arm window, so
 * fs-event watching — fs.watch or chokidar — cannot be lossless); the
 * EXTERNAL contract the callers depend on must be intact:
 *
 *   - it stamps by PATH, not inode, so the State Store's atomic tmp+rename
 *     is still seen (an inode watch goes dead after rename);
 *   - it filters by basename, so unrelated siblings in the dir don't trigger;
 *   - it debounces bursts into a single trigger;
 *   - `debounceMs <= 0` is a no-op (callers use it as the "watching disabled"
 *     switch);
 *   - `stop()` fully stops the poll — no further triggers, no leaked timers.
 *
 * These run against a real temp dir; the poll and debounce are plain timers,
 * so fake timers step them deterministically (statSync stays real).
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { startFileWatchTrigger } from "@sma1lboy/rove-daemon/daemon/file-watch-trigger"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

/** Longer than the trigger's 200ms stat-poll plus any debounce used below. */
const SETTLE_MS = 300

let tmpDir: string
let filePath: string
let stop: (() => void) | null

beforeEach(() => {
  vi.useFakeTimers()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rove-fwt-"))
  filePath = path.join(tmpDir, "state.json")
  stop = null
})

afterEach(() => {
  stop?.()
  stop = null
  vi.useRealTimers()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function watch(opts: { debounceMs: number; matchBasenames?: string[] }): { triggers: () => number } {
  let triggers = 0
  stop = startFileWatchTrigger({
    filePath,
    ...opts,
    onTrigger: () => {
      triggers += 1
    },
    onError: (err) => {
      throw err
    },
  })
  return { triggers: () => triggers }
}

describe("startFileWatchTrigger", () => {
  test("fires on a matching file add and on a later change", () => {
    const w = watch({ debounceMs: 25 })

    fs.writeFileSync(filePath, "{}", "utf8")
    vi.advanceTimersByTime(SETTLE_MS)
    expect(w.triggers()).toBe(1)

    fs.writeFileSync(filePath, '{"x":1}', "utf8")
    vi.advanceTimersByTime(SETTLE_MS)
    expect(w.triggers()).toBe(2)
  })

  test("survives an atomic tmp+rename swap (stamps the path, not the inode)", () => {
    const w = watch({ debounceMs: 25 })
    // Production write path: write a tmp sibling, then rename it over the
    // target. An inode watch on `state.json` would miss this.
    const tmp = path.join(tmpDir, "state.json.tmp")
    const swap = (body: string): void => {
      fs.writeFileSync(tmp, body, "utf8")
      fs.renameSync(tmp, filePath)
    }

    swap("{}")
    vi.advanceTimersByTime(SETTLE_MS)
    expect(w.triggers()).toBe(1)

    // A second rename still lands — the watch is alive after the first swap.
    swap('{"x":2}')
    vi.advanceTimersByTime(SETTLE_MS)
    expect(w.triggers()).toBe(2)
  })

  test("ignores siblings that don't match the watched basename(s)", () => {
    const w = watch({ debounceMs: 25, matchBasenames: ["alias.json"] })

    fs.writeFileSync(path.join(tmpDir, "unrelated.txt"), "noise", "utf8")
    vi.advanceTimersByTime(SETTLE_MS)
    expect(w.triggers()).toBe(0)

    // An additional matched basename DOES trigger.
    fs.writeFileSync(path.join(tmpDir, "alias.json"), "{}", "utf8")
    vi.advanceTimersByTime(SETTLE_MS)
    expect(w.triggers()).toBe(1)
  })

  test("debounces changes seen across several polls into a single trigger", () => {
    // Debounce longer than the poll, so each detected change re-arms it.
    const w = watch({ debounceMs: 500 })

    fs.writeFileSync(filePath, "1", "utf8")
    vi.advanceTimersByTime(200)
    fs.writeFileSync(filePath, "22", "utf8")
    vi.advanceTimersByTime(200)
    fs.writeFileSync(filePath, "333", "utf8")
    vi.advanceTimersByTime(200)
    expect(w.triggers()).toBe(0)

    vi.advanceTimersByTime(1_000)
    expect(w.triggers()).toBe(1)
  })

  test("stop() clears a pending debounce and the poll — no triggers after stop", () => {
    const w = watch({ debounceMs: 25 })
    fs.writeFileSync(filePath, "{}", "utf8")
    vi.advanceTimersByTime(SETTLE_MS)
    expect(w.triggers()).toBe(1)

    // Land the next poll so a debounce is pending, then stop.
    fs.writeFileSync(filePath, '{"x":9}', "utf8")
    vi.advanceTimersByTime(100)
    stop?.()
    vi.advanceTimersByTime(1_000)
    expect(w.triggers()).toBe(1)
    expect(vi.getTimerCount()).toBe(0)

    // Double-stop is safe.
    stop?.()
  })
})
