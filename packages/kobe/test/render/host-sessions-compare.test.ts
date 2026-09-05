/**
 * `sameSessions` — the comparator that decides whether a pty-host poll
 * rebuilds the sidebar tree.
 *
 * It lives behind a gate that is OFF under every runner: `pollingAllowed()`
 * exists so a mounted sidebar cannot pin the shared PTY client and strand
 * `pty-hosted.test.ts`, and nothing passes `enabled = true`. So the poll body
 * and this comparator never executed in any track. The function is pure, so a
 * direct test is the whole of it — and it belongs on the render track because
 * its module value-imports react, which vitest's node environment never runs.
 *
 * Too loose and a renamed tab never shows; too tight and a quiet host
 * re-renders the tree every two seconds forever.
 */

import { describe, expect, test } from "bun:test"
import type { LiveSession } from "../../src/tui-react/panes/sidebar/orphan-tabs"
import { sameSessions } from "../../src/tui-react/panes/sidebar/use-host-sessions"

const session = (over: Partial<LiveSession> = {}): LiveSession =>
  ({ key: "task-1:tab-1", alive: true, title: "claude", ...over }) as LiveSession

describe("sameSessions", () => {
  test("treats a fresh array with identical rows as unchanged — the quiet-host case", () => {
    // The poll allocates a new array every tick, so identity comparison would
    // rebuild the tree every 2 seconds forever.
    expect(sameSessions([session()], [session()])).toBe(true)
    expect(sameSessions([], [])).toBe(true)
  })

  test("reports a change when a session appears or disappears", () => {
    expect(sameSessions([], [session()])).toBe(false)
    expect(sameSessions([session()], [])).toBe(false)
  })

  test("reports a change on each field the tree reads", () => {
    expect(sameSessions([session()], [session({ key: "task-2:tab-1" })])).toBe(false)
    expect(sameSessions([session()], [session({ alive: false })])).toBe(false)
    // The title projection is the reason this comparator got fields at all.
    expect(sameSessions([session()], [session({ title: "codex" })])).toBe(false)
    // A host death turns live sessions into freeze-restored corpses in place:
    // same key, same title, and `alive` was already false for other reasons.
    // If this field is not compared, the row keeps the glyph that says
    // "nothing to do here" until some unrelated field happens to move.
    expect(sameSessions([session()], [session({ restored: true })])).toBe(false)
    expect(sameSessions([session({ restored: true })], [session({ restored: true })])).toBe(true)
  })

  test("a respawned shell changes the inventory even when its key, title and liveness match", () => {
    expect(sameSessions([session({ pid: 101 })], [session({ pid: 202 })])).toBe(false)
    expect(sameSessions([session()], [session({ pid: 202 })])).toBe(false)
    expect(sameSessions([session({ pid: 101 })], [session({ pid: null })])).toBe(false)
    expect(sameSessions([session({ pid: 101 })], [session({ pid: 101 })])).toBe(true)
  })

  test("compares position by position, so a reordered inventory is a change", () => {
    const a = [session({ key: "a" }), session({ key: "b" })]
    const b = [session({ key: "b" }), session({ key: "a" })]
    expect(sameSessions(a, b)).toBe(false)
  })
})
