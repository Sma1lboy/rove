/**
 * The FileTree `a` mention action — the `@<path>` shape and the paste link
 * that delivers it. Documented in docs/TUI.md ("pastes an @path mention into
 * the active engine without submitting it") and in the `files.mention`
 * keybinding row. The path is worktree-relative: the engine session's cwd IS
 * the worktree, so a plain `@path` resolves there.
 *
 * `mentionAction` is the React-free core (sibling of `createPRAction`), so
 * the ref hand-off is pinned here rather than only at the pane boundary —
 * breaking the paste call must fail a test, not just the wiring above it.
 */

import { describe, expect, test } from "bun:test"
import { mentionAction } from "../../src/tui-react/workspace/use-editor-handles"

describe("mentionAction", () => {
  test("pastes the `@<path>` mention through the engine paste handle", () => {
    const pasted: string[] = []
    const ref = {
      current: (text: string) => {
        pasted.push(text)
        return true
      },
    }
    mentionAction(ref, () => {
      throw new Error("a delivered paste must not report a refusal")
    })("src/a.ts")
    expect(pasted).toEqual(["@src/a.ts"])
  })

  test("reports a refusal when no paste handle has been handed up yet", () => {
    // Silence here is the bug the guard exists for: the key looked dead and
    // the user had no way to tell that from a delivered mention.
    let refused = 0
    const ref: { current: ((text: string) => boolean) | null } = { current: null }
    mentionAction(ref, () => {
      refused += 1
    })("src/a.ts")
    expect(refused).toBe(1)
  })
})
