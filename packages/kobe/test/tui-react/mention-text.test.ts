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

import { describe, expect, test } from "vitest"
import { mentionAction, mentionText } from "../../src/tui-react/workspace/use-editor-handles"

describe("mentionText", () => {
  test("prefixes the worktree-relative path with @", () => {
    expect(mentionText("src/a.ts")).toBe("@src/a.ts")
    expect(mentionText("README.md")).toBe("@README.md")
  })
})

describe("mentionAction", () => {
  test("pastes the `@<path>` mention through the engine paste handle", () => {
    const pasted: string[] = []
    const ref = { current: (text: string) => void pasted.push(text) }
    mentionAction(ref)("src/a.ts")
    expect(pasted).toEqual(["@src/a.ts"])
  })

  test("reads the ref at call time — a remount's fresh paste closure wins", () => {
    const first: string[] = []
    const second: string[] = []
    const ref: { current: ((text: string) => void) | null } = {
      current: (t: string) => void first.push(t),
    }
    const mention = mentionAction(ref)
    ref.current = (t: string) => void second.push(t)
    mention("b.ts")
    expect(first).toEqual([])
    expect(second).toEqual(["@b.ts"])
  })

  test("is inert with no live engine tab (no paste handle handed up yet)", () => {
    const ref: { current: ((text: string) => void) | null } = { current: null }
    expect(() => mentionAction(ref)("src/a.ts")).not.toThrow()
  })
})
