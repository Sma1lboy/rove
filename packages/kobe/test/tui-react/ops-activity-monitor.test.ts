import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TranscriptScan } from "../../src/engine/turn-detector"
import { type TurnSession, startTurnStatusPoll } from "../../src/tui/ops/activity-monitor"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function scan(id: string | null, mtimeMs = 1): TranscriptScan {
  return { mtimeMs, marker: id ? { id, timestampMs: mtimeMs, source: "claude" } : null }
}

function fixture() {
  const files = new Map<string, TranscriptScan | null>([
    ["/shared/a.jsonl", scan("a0")],
    ["/shared/b.jsonl", scan("b0")],
  ])
  const read = vi.fn(async (path: string) => files.get(path) ?? null)
  function tab(id: string) {
    let pane = "ready"
    let session: TurnSession | null = { id, transcriptPath: `/shared/${id}.jsonl` }
    const published: string[] = []
    const stop = startTurnStatusPoll(
      {
        detector: { supportsCompletionMarkers: () => true, latestActivityInFile: read },
        session: () => session,
      },
      {
        sessionAttached: async () => true,
        capturePane: async () => pane,
        setTurnState: async (state) => {
          published.push(state)
        },
      },
    )
    return {
      published,
      stop,
      setPane: (text: string) => {
        pane = text
      },
      setSession: (next: TurnSession | null) => {
        session = next
      },
    }
  }
  return { files, read, tab }
}

describe("per-session turn polling", () => {
  it("does not complete A when B completes, even after A changed and became quiet", async () => {
    const f = fixture()
    const a = f.tab("a")
    const b = f.tab("b")
    try {
      await vi.advanceTimersByTimeAsync(0)
      a.setPane("A working")
      b.setPane("B working")
      await vi.advanceTimersByTimeAsync(1500)
      f.files.set("/shared/b.jsonl", scan("b1", 2))
      await vi.advanceTimersByTimeAsync(4500)
      expect(a.published).toEqual(["idle", "running"])
      expect(b.published).toEqual(["idle", "running", "done"])
      f.files.set("/shared/a.jsonl", scan("a1", 3))
      await vi.advanceTimersByTimeAsync(6000)
      expect(a.published).toEqual(["idle", "running", "done"])
      expect(b.published).toEqual(["idle", "running", "done"])
    } finally {
      a.stop()
      b.stop()
    }
  })

  it("does not report completion when only the transcript changes and the paired PTY never did", async () => {
    const f = fixture()
    const a = f.tab("a")
    try {
      await vi.advanceTimersByTimeAsync(0)
      f.files.set("/shared/a.jsonl", scan("a1", 2))
      await vi.advanceTimersByTimeAsync(15000)
      expect(a.published).toEqual(["idle"])
    } finally {
      a.stop()
    }
  })

  it("resets the baseline across /clear and never reads the previous session again", async () => {
    const f = fixture()
    const a = f.tab("a")
    try {
      await vi.advanceTimersByTimeAsync(0)
      a.setPane("old working")
      await vi.advanceTimersByTimeAsync(1500)
      f.files.set("/shared/new.jsonl", scan("new0"))
      a.setSession({ id: "new", transcriptPath: "/shared/new.jsonl" })
      await vi.advanceTimersByTimeAsync(1500)
      f.read.mockClear()
      f.files.set("/shared/a.jsonl", scan("old-late-completion", 500))
      a.setPane("new working")
      await vi.advanceTimersByTimeAsync(6000)
      expect(a.published).toEqual(["idle", "running", "idle", "running"])
      expect(f.read.mock.calls.every(([path]) => path === "/shared/new.jsonl")).toBe(true)
      f.files.set("/shared/new.jsonl", scan("new1", 2))
      await vi.advanceTimersByTimeAsync(1500)
      expect(a.published.at(-1)).toBe("done")
    } finally {
      a.stop()
    }
  })

  it.each(["missing", "unreadable", "unknown"] as const)(
    "does not borrow another session when its own is %s",
    async (mode) => {
      const f = fixture()
      const a = f.tab("a")
      try {
        await vi.advanceTimersByTimeAsync(0)
        a.setPane("working")
        await vi.advanceTimersByTimeAsync(1500)
        if (mode === "unknown") a.setSession(null)
        else if (mode === "missing") f.files.set("/shared/a.jsonl", null)
        else
          f.read.mockImplementation(async () => {
            throw new Error("unreadable")
          })
        f.files.set("/shared/b.jsonl", scan("b1", 900))
        await vi.advanceTimersByTimeAsync(15000)
        expect(a.published).not.toContain("done")
        expect(f.read.mock.calls.every(([path]) => path === "/shared/a.jsonl")).toBe(true)
      } finally {
        a.stop()
      }
    },
  )

  it.each(["clear", "close"] as const)("ignores an in-flight completion after %s", async (event) => {
    const f = fixture()
    const a = f.tab("a")
    try {
      await vi.advanceTimersByTimeAsync(0)
      a.setPane("working")
      await vi.advanceTimersByTimeAsync(4500)
      let finish: ((value: TranscriptScan) => void) | undefined
      f.read.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      await vi.advanceTimersByTimeAsync(1500)
      if (event === "clear") a.setSession({ id: "new", transcriptPath: "/shared/new.jsonl" })
      else a.stop()
      finish?.(scan("late", 100))
      await vi.advanceTimersByTimeAsync(0)
      expect(a.published).not.toContain("done")
    } finally {
      a.stop()
    }
  })

  it("uses only the paired screen when the engine has no transcript identity", async () => {
    let pane = "ready"
    const published: string[] = []
    const read = vi.fn(async () => null)
    const stop = startTurnStatusPoll(
      {
        detector: { supportsCompletionMarkers: () => true, latestActivityInFile: read },
        session: () => null,
        screenManifest: {
          rules: [
            { state: "working", any: ["esc to cancel"] },
            { state: "blocked", all: ["proceed?"] },
          ],
        },
      },
      {
        sessionAttached: async () => true,
        capturePane: async () => pane,
        setTurnState: async (state) => {
          published.push(state)
        },
      },
    )
    try {
      await vi.advanceTimersByTimeAsync(0)
      pane = "Esc to cancel"
      await vi.advanceTimersByTimeAsync(1500)
      pane = "proceed?"
      await vi.advanceTimersByTimeAsync(1500)
      expect(published).toEqual(["unknown", "running", "needs_input"])
      expect(read).not.toHaveBeenCalled()
    } finally {
      stop()
    }
  })
})
