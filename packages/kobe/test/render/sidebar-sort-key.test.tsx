/** @jsxImportSource @opentui/react */
/**
 * The `t` sort chord, pressed for real. The wiring that matters lives in the
 * WORKSPACE host (`useWorkspaceKeybindings` → `toggleSortMode` → the
 * `sortMode` prop), not in the SidebarTree's own binding block — the tree
 * only renders the order it is given. So this mounts the real host binding
 * hook next to the real tree, presses `t` through the mock input, and asserts
 * the frame's row order actually flips between `default` (stored order) and
 * `recent` (updatedAt-desc). A frame-only probe can't catch a dead chord; a
 * binding that was never registered renders identically to one that works.
 */
import { expect, test } from "bun:test"
import { useState } from "react"
import { useFocus } from "../../src/tui-react/context/focus"
import { SidebarTree } from "../../src/tui-react/panes/sidebar/SidebarTree"
import { useDialog } from "../../src/tui-react/ui/dialog"
import { useWorkspaceKeybindings } from "../../src/tui-react/workspace/host-keybindings"
import type { HostPagesState } from "../../src/tui-react/workspace/host-pages"
import type { TaskSortMode } from "../../src/tui/panes/sidebar/groups"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { renderComponent } from "./harness"

const SETTLE = 80

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id: toTaskId(id),
    title: id,
    repo: "/repos/rove",
    branch: `feat/${id}`,
    worktreePath: `/wt/${id}`,
    kind: "task",
    status: "in_progress",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  }
}

/** One project whose regular worktrees sit in stored order by default. */
const MAIN = task("m", { kind: "main", branch: "", worktreePath: "/repos/rove" })
const OLDER = task("aaa", { updatedAt: "2026-08-01T00:00:00.000Z" })
const NEWER = task("zzz", { updatedAt: "2026-08-20T00:00:00.000Z" })

/** All pages closed — the gate `useWorkspaceKeybindings` requires. */
function closedPages(): HostPagesState {
  const noop = () => {}
  return {
    nav: "terminal",
    setNav: noop,
    goToNav: noop,
    settingsOpen: false,
    openSettings: noop,
    closeSettings: noop,
    worktreesOpen: false,
    openWorktrees: noop,
    closeWorktrees: noop,
    updateOpen: false,
    openUpdate: noop,
    closeUpdate: noop,
    kanbanOpen: false,
    openKanban: noop,
    closeKanban: noop,
    automationsOpen: false,
    openAutomations: noop,
    closeAutomations: noop,
    workItemsOpen: false,
    openWorkItems: noop,
    closeWorkItems: noop,
  }
}

/** The real host binding hook, minus the app: `t` flips local sort state. */
function SortHost() {
  const focus = useFocus()
  const dialog = useDialog()
  const [sortMode, setSortMode] = useState<TaskSortMode>("default")
  useWorkspaceKeybindings({
    focus,
    dialog,
    pages: closedPages(),
    searchActive: false,
    selectedId: OLDER.id,
    openTaskWorktree: () => {},
    createTask: () => {},
    renameBranch: () => {},
    cycleVendor: () => {},
    toggleZen: () => {},
    jumpToNextAttention: () => {},
    openInbox: () => {},
    enterMoveMode: () => {},
    createPR: () => {},
    toggleSortMode: () => setSortMode((mode) => (mode === "default" ? "recent" : "default")),
  })
  return (
    <SidebarTree
      tasks={[MAIN, OLDER, NEWER]}
      selectedId={OLDER.id}
      selectedTabId={null}
      onSelect={() => {}}
      focused={focus.focused === "sidebar"}
      sortMode={sortMode}
      width={28}
    />
  )
}

function orderOf(frame: string): number {
  return frame.indexOf("feat/aaa") - frame.indexOf("feat/zzz")
}

test("t flips the sidebar between default and recent sort", async () => {
  const { frame, mockInput } = await renderComponent(<SortHost />, {
    width: 28,
    height: 20,
    providers: { focus: true, dialog: true },
  })
  await new Promise((r) => setTimeout(r, SETTLE))

  // Default sort keeps the stored order: aaa before zzz.
  expect(orderOf(await frame())).toBeLessThan(0)

  // `t` — the sidebar-scoped chord the F1 keymap advertises — flips to
  // recency: zzz (touched 2026-08-20) jumps above aaa (2026-08-01).
  mockInput.typeText("t")
  await new Promise((r) => setTimeout(r, SETTLE))
  expect(orderOf(await frame())).toBeGreaterThan(0)

  // And back again — the chord TOGGLES, it doesn't latch.
  mockInput.typeText("t")
  await new Promise((r) => setTimeout(r, SETTLE))
  expect(orderOf(await frame())).toBeLessThan(0)
})
