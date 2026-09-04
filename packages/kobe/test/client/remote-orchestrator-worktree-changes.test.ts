/**
 * The `worktree.changes` wire contract's pure helpers — parsing a payload and
 * comparing two maps.
 *
 * Split from `remote-orchestrator.test.ts` along the same seam as the source
 * (`remote-orchestrator-worktree-changes.ts`): this channel is the one whose
 * payload says two different things about a key, so "counts", "not collected"
 * and "could not read" all have to stay distinguishable here. The sibling file
 * covers the orchestrator's channel plumbing.
 */

import { describe, expect, it } from "vitest"
import {
  type WorktreeChangesMap,
  parseWorktreeChangesPayload,
  sameWorktreeChangesMap,
} from "../../src/client/remote-orchestrator.ts"

describe("worktree.changes pure helpers", () => {
  it("parseWorktreeChangesPayload accepts an empty map and rejects malformed entries", () => {
    expect(parseWorktreeChangesPayload({ changes: {} })?.size).toBe(0)
    expect(parseWorktreeChangesPayload(undefined)).toBeNull()
    expect(parseWorktreeChangesPayload({ changes: [] })).toBeNull()
    expect(parseWorktreeChangesPayload({ changes: { "/wt": { added: 1 } } })).toBeNull()
  })

  it("parseWorktreeChangesPayload maps the daemon's unreadable paths to null", () => {
    // `unreadable` is additive: an older daemon omits it entirely, and the
    // parser must still accept the payload rather than reject the whole map.
    expect(parseWorktreeChangesPayload({ changes: { "/wt": { added: 1, deleted: 0 } } })).toEqual(
      new Map([["/wt", { added: 1, deleted: 0 }]]),
    )
    const withUnreadable = parseWorktreeChangesPayload({
      changes: { "/wt": { added: 1, deleted: 0 } },
      unreadable: ["/wt/broken"],
    })
    // PRESENT with a null value, not absent: absent would read as a clean row.
    expect(withUnreadable?.has("/wt/broken")).toBe(true)
    expect(withUnreadable?.get("/wt/broken")).toBeNull()
  })

  it("sameWorktreeChangesMap tells an unreadable entry from a missing one", () => {
    const unreadable: WorktreeChangesMap = new Map([["/wt", null]])
    expect(sameWorktreeChangesMap(unreadable, new Map([["/wt", null]]))).toBe(true)
    expect(sameWorktreeChangesMap(unreadable, new Map([["/wt", { added: 0, deleted: 0 }]]))).toBe(false)
    expect(sameWorktreeChangesMap(unreadable, new Map())).toBe(false)
  })

  it("sameWorktreeChangesMap compares entry-wise", () => {
    const a = new Map([["/wt", { added: 1, deleted: 2 }]])
    expect(sameWorktreeChangesMap(a, new Map([["/wt", { added: 1, deleted: 2 }]]))).toBe(true)
    expect(sameWorktreeChangesMap(a, new Map([["/wt", { added: 1, deleted: 3 }]]))).toBe(false)
    expect(sameWorktreeChangesMap(a, new Map())).toBe(false)
  })
})
