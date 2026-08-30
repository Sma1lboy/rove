/**
 * Architecture guard: the Files pane `a` mention must stay WIRED.
 *
 * The chord (`files.mention`) ships in the keymap, so it shows in F1 and is
 * user-rebindable. Its handler chain is
 * `FileTree.onMention` → `HostFilesPane` → `host.tsx` → `useEditorHandles`
 * → the engine paste handle. Before this guard the chain's last link had NO
 * producer at all: every layer type-checked, the key was advertised, and
 * pressing it did nothing.
 *
 * Types now cover most of the chain (both `onMention` and `onEnginePasteReady`
 * are required props). What types CANNOT see is a host that keeps the prop but
 * hands down a do-nothing lambda — that still compiles and is still a dead key.
 * These assertions pin the two call sites a stub would have to survive.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const src = (rel: string): string => readFileSync(fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)), "utf8")

describe("FileTree `a` mention stays wired", () => {
  test("useEditorHandles returns the real mention action, not a stub", () => {
    const text = src("tui-react/workspace/use-editor-handles.tsx")
    expect(text).toContain("onMention: mentionAction(pasteToEngineFn)")
  })

  test("the workspace host passes both halves down to the panes", () => {
    const text = src("tui-react/workspace/host.tsx")
    // The Files pane gets the mention callback…
    expect(text).toContain("onMention={editor.onMention}")
    // …and the workspace hands up the paste handle it needs to deliver it.
    expect(text).toContain("onEnginePasteReady={editor.onEnginePasteReady}")
  })

  test("the keymap row that advertises the chord still exists", () => {
    expect(src("tui/context/keybindings-files.ts")).toContain('id: "files.mention"')
  })
})
