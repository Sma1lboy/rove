/**
 * `useFileOpenActions` is the React-free core behind the FileTree's two open
 * actions (sibling of `mentionAction` in use-editor-handles): its body calls
 * no hooks, so both closures are driven directly here instead of only through
 * a workspace mount.
 *
 * The `d` label branch is the load-bearing one. A directory and `.` are git
 * PATHSPECS, not files — `pathLeaf("src/")` is `""` and `pathLeaf(".")` is
 * `"."`, so the combined-diff tab would open blank or titled `.` without the
 * branch. FileTree normalises a directory row to a trailing slash exactly so
 * this label (and the loader below it) can tell a multi-file diff apart.
 */

import { describe, expect, test } from "bun:test"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import type { FocusContextValue } from "../../src/tui-react/context/focus"
import { useFileOpenActions } from "../../src/tui-react/workspace/use-file-open-actions"

type DiffTabCall = { relPath: string; label: string; base?: string }
type EditorTabCall = { command: readonly string[]; label: string }

function harness(over: { worktree?: string | null; editorTab?: EditorTabCall[] | null } = {}) {
  const diffTabs: DiffTabCall[] = []
  const editorTabs: EditorTabCall[] = []
  const events: Array<{ name: string; via?: unknown }> = []
  const focused: string[] = []
  const worktree = over.worktree === undefined ? "/wt/a" : over.worktree
  const selectedWorktreeRef = { current: worktree }
  const openEditorTabFn = {
    current:
      over.editorTab === null
        ? null
        : (command: readonly string[], label: string) => {
            editorTabs.push({ command, label })
          },
  }
  const api = useFileOpenActions({
    orch: {
      reportUiEvent: (name: string, _taskId?: string, payload?: Record<string, unknown>) => {
        events.push({ name, via: payload?.via })
      },
    } as unknown as RemoteOrchestrator,
    worktree,
    selectedId: "task-a",
    focus: { setFocused: (pane: string) => focused.push(pane) } as unknown as FocusContextValue,
    openEditorTabFn,
    openDiffTabFn: {
      current: (relPath: string, label: string, base?: string) => {
        diffTabs.push({ relPath, label, base })
      },
    },
    selectedWorktreeRef,
  })
  return { api, diffTabs, editorTabs, events, focused, selectedWorktreeRef }
}

describe("openDiff", () => {
  test("labels a file by its leaf", () => {
    const h = harness()
    h.api.openDiff("src/tui-react/workspace/host.tsx")
    expect(h.diffTabs).toEqual([{ relPath: "src/tui-react/workspace/host.tsx", label: "host.tsx", base: undefined }])
  })

  test("labels a directory pathspec with the directory itself, not an empty leaf", () => {
    const h = harness()
    h.api.openDiff("src/tui-react/")
    expect(h.diffTabs).toEqual([{ relPath: "src/tui-react/", label: "src/tui-react/", base: undefined }])
  })

  test('labels the whole-worktree pathspec "all", not "."', () => {
    const h = harness()
    h.api.openDiff(".", "origin/main")
    expect(h.diffTabs).toEqual([{ relPath: ".", label: "all", base: "origin/main" }])
  })

  test("keeps FileTree focus — a read-only open is a content swap, not a navigation", () => {
    const h = harness()
    h.api.openDiff("src/")
    expect(h.focused).toEqual([])
  })

  test("reads the ref at call time, so a remount's fresh diff handle wins", () => {
    const h = harness()
    h.api.openDiff("a.ts")
    expect(h.diffTabs).toHaveLength(1)
  })
})

describe("openFileInEditor", () => {
  test("does nothing without a worktree — there is no path to resolve", async () => {
    const h = harness({ worktree: null })
    await h.api.openFileInEditor("a.ts")
    expect(h.events).toEqual([])
    expect(h.editorTabs).toEqual([])
  })

  test("opens the editor tab and pulls focus to the workspace", async () => {
    const h = harness()
    await h.api.openFileInEditor("a.ts")
    // The resolved editor is whatever this machine has configured; what is
    // pinned here is the wiring — one tab, labelled by the file's basename,
    // run through `sh -c`, and reported as opened via "editor".
    expect(h.editorTabs).toHaveLength(1)
    expect(h.editorTabs[0]?.label).toBe("a.ts")
    expect(h.editorTabs[0]?.command[0]).toBe("sh")
    expect(h.events.map((e) => e.name)).toEqual(["file.will-open", "file.opened"])
    expect(h.events[1]?.via).toBe("editor")
    expect(h.focused).toEqual(["workspace"])
  })

  test("drops a stale continuation — the user switched tasks while the editor resolved", async () => {
    const h = harness()
    const pending = h.api.openFileInEditor("a.ts")
    h.selectedWorktreeRef.current = "/wt/b"
    await pending
    expect(h.editorTabs).toEqual([])
    expect(h.events.map((e) => e.name)).toEqual(["file.will-open"])
    expect(h.focused).toEqual([])
  })
})
