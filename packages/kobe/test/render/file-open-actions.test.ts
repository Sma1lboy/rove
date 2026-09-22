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

function harness() {
  const diffTabs: DiffTabCall[] = []
  const api = useFileOpenActions({
    orch: { reportUiEvent: () => {} } as unknown as RemoteOrchestrator,
    worktree: "/wt/a",
    selectedId: "task-a",
    focus: { setFocused: () => {} } as unknown as FocusContextValue,
    openEditorTabFn: { current: null },
    openDiffTabFn: {
      current: (relPath: string, label: string, base?: string) => {
        diffTabs.push({ relPath, label, base })
      },
    },
    selectedWorktreeRef: { current: "/wt/a" },
  })
  return { api, diffTabs }
}

describe("openDiff", () => {
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
})

describe("openFileInEditor", () => {})
