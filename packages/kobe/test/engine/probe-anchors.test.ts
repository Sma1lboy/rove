/**
 * Every snapshot caller has to hand the probe the shell pids it is about to
 * walk.
 *
 * On POSIX the anchors are ignored, so nothing here can fail on macOS/Linux
 * for the reason it exists — and that is exactly the risk: a caller that
 * silently stopped passing them would leave every POSIX test green while
 * Windows went back to reporting `running: false` for live agents, because
 * the ConPTY console repair has nothing to anchor on
 * (`win-process-snapshot.ts`). These lock the plumbing itself.
 */

import { describe, expect, it } from "vitest"
import { foregroundEngine } from "../../src/engine/foreground.ts"
import { enginePresence, sessionHasEngine } from "../../src/engine/session-engine-presence.ts"
import type { TaskPtyLike } from "../../src/tui/panes/terminal/pty-types"
import { createLiveEngines } from "../../src/tui/workspace/live-engine"

const TREE = "100 1 -zsh\n101 100 claude --resume abc\n200 1 -zsh\n"

/** A snapshot that records the anchors it was handed. */
function recording(): { snapshot: (anchors?: readonly number[]) => Promise<string>; seen: number[][] } {
  const seen: number[][] = []
  return {
    snapshot: async (anchors) => {
      seen.push([...(anchors ?? [])])
      return TREE
    },
    seen,
  }
}

describe("walk anchors reach the snapshot", () => {
  it("enginePresence anchors on the session pid it is asked about", async () => {
    const rec = recording()
    expect(await enginePresence(100, undefined, rec.snapshot)).toBe("engine")
    expect(await sessionHasEngine(200, undefined, rec.snapshot)).toBe(false)
    expect(rec.seen).toEqual([[100], [200]])
  })

  it("foregroundEngine anchors on the shell it walks", async () => {
    const rec = recording()
    expect(await foregroundEngine(100, rec.snapshot)).toMatchObject({ vendor: "claude" })
    expect(rec.seen).toEqual([[100]])
  })

  it("the live-engine store anchors on every pid in one pass", async () => {
    const rec = recording()
    const pty = (shellPid: number): TaskPtyLike => ({ shellPid }) as unknown as TaskPtyLike
    const store = createLiveEngines({
      entries: () => [
        ["a", pty(100)],
        ["b", pty(200)],
      ],
      snapshot: rec.snapshot,
    })
    await store.probe()
    expect(store.get("a")).toBe("claude")
    // ONE snapshot for the whole tick, carrying both shells.
    expect(rec.seen).toHaveLength(1)
    expect([...rec.seen[0]].sort((x, y) => x - y)).toEqual([100, 200])
    store.dispose()
  })
})
