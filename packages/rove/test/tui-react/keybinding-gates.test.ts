/**
 * Pins the workspace-host gating contract (workspace/keybinding-gates.ts):
 * an open dialog or full-page swap disables every workspace chord group.
 */

import { describe, expect, test } from "vitest"
import {
  type WorkspacePageState,
  nextFocusedPane,
  workspacePagesClosed,
} from "../../src/tui-react/workspace/keybinding-gates"

const closed: WorkspacePageState = {
  dialogOpen: false,
  settingsOpen: false,
  worktreesOpen: false,
  updateOpen: false,
}

describe("workspacePagesClosed", () => {
  test("true only when nothing is open", () => {
    expect(workspacePagesClosed(closed)).toBe(true)
  })

  test("an open dialog disables workspace bindings", () => {
    expect(workspacePagesClosed({ ...closed, dialogOpen: true })).toBe(false)
  })

  test.each(["settingsOpen", "worktreesOpen", "updateOpen"] as const)(
    "an open full-window %s page disables them too",
    (page) => {
      expect(workspacePagesClosed({ ...closed, [page]: true })).toBe(false)
    },
  )
})

describe("nextFocusedPane", () => {
  const withFiles = { filesVisible: true }
  const noFiles = { filesVisible: false }

  test("steps through all three panes when files is mounted", () => {
    expect(nextFocusedPane("sidebar", 1, withFiles)).toBe("workspace")
    expect(nextFocusedPane("workspace", 1, withFiles)).toBe("files")
    expect(nextFocusedPane("files", -1, withFiles)).toBe("workspace")
  })

  test("clamps at both ends rather than wrapping", () => {
    // Cursor semantics: "previous" from the sidebar must never jump to files.
    expect(nextFocusedPane("sidebar", -1, withFiles)).toBeNull()
    expect(nextFocusedPane("files", 1, withFiles)).toBeNull()
  })

  test("skips the files pane when it is not mounted", () => {
    // Zen, or any rail page — focusing an unmounted pane would strand the
    // cursor on nothing.
    expect(nextFocusedPane("workspace", 1, noFiles)).toBeNull()
    expect(nextFocusedPane("sidebar", 1, noFiles)).toBe("workspace")
  })

  test("rescues focus that was left on a pane which just vanished", () => {
    // Opening a rail page while focus sat on files: there is no index to step
    // from, so land on the nearest end instead of doing nothing forever.
    expect(nextFocusedPane("files", -1, noFiles)).toBe("sidebar")
    expect(nextFocusedPane("files", 1, noFiles)).toBe("workspace")
  })
})
