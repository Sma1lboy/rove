import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { recordPtyExit } from "@sma1lboy/kobe-daemon/daemon/pty-exit-store"
import { startPtyExitWatch } from "@sma1lboy/kobe-daemon/daemon/pty-exit-watch"
import { afterEach, describe, expect, it } from "vitest"

const dirs: string[] = []
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "kobe-pty-exit-watch-"))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function waitFor(predicate: () => boolean, ms = 5_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 25))
  }
}

function exitInfo(key: string, at: string) {
  return { key, pid: 42, exit: { code: 1, signal: null, at }, tail: "boom\n" }
}

describe("startPtyExitWatch", () => {
  it("fires session.exited for NEW records only, with parsed task/tab", async () => {
    const path = join(tmp(), "pty-exits.json")
    // Pre-existing corpse — baseline, must not fire.
    recordPtyExit(exitInfo("old-task::tab-1", "2026-01-01T00:00:00.000Z"), path)

    const reports: { kind: string; taskId?: string; detail?: Record<string, unknown> }[] = []
    const stop = startPtyExitWatch({
      path,
      plugins: () => ({ handleUiReport: (r) => reports.push(r) }),
    })
    try {
      recordPtyExit(exitInfo("task-9::tab-3", "2026-01-02T00:00:00.000Z"), path)
      await waitFor(() => reports.length > 0)
      expect(reports).toEqual([
        {
          kind: "session.exited",
          taskId: "task-9",
          detail: {
            key: "task-9::tab-3",
            tabId: "tab-3",
            pid: 42,
            code: 1,
            signal: null,
            exitedAt: "2026-01-02T00:00:00.000Z",
            tail: ["boom"],
          },
        },
      ])
      // Rewriting the SAME record (same key+at) must not re-fire.
      recordPtyExit(exitInfo("task-9::tab-3", "2026-01-02T00:00:00.000Z"), path)
      await new Promise((r) => setTimeout(r, 400))
      expect(reports.length).toBe(1)
    } finally {
      stop()
    }
  })
})
