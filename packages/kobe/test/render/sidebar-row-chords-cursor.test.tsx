/** @jsxImportSource @opentui/react */
/**
 * The sidebar's `b` / `v` / `o` chords target the CURSOR row, not the active
 * task. `j`/`k` move the cursor without selecting (only enter selects), so
 * after one `j` the two differ, and a chord bound to the active task would
 * rename a git branch while the highlight sits on another row. Same shape
 * as sidebar-sort-key.test.tsx: the real host binding hook mounted next to
 * the real tree, keys pressed through the mock input.
 */
import { expect, test } from "bun:test"
import { useRef } from "react"
import { useFocus } from "../../src/tui-react/context/focus"
import { SidebarTree } from "../../src/tui-react/panes/sidebar/SidebarTree"
import { useDialog } from "../../src/tui-react/ui/dialog"
import { useWorkspaceKeybindings } from "../../src/tui-react/workspace/host-keybindings"
import type { HostPagesState } from "../../src/tui-react/workspace/host-pages"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { renderComponent } from "./harness"

const SETTLE = 80

function task(id: string): Task {
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
  }
}

const A = task("a")
const B = task("b")

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

type Spies = { renameBranch: string[]; cycleVendor: string[]; openTaskWorktree: string[] }

/** The real host wiring: the tree fills the cursor reader, the hook reads it. */
function ChordHost({ spies }: { spies: Spies }) {
  const focus = useFocus()
  const dialog = useDialog()
  const cursorTaskIdRef = useRef<() => string | null>(() => null)
  useWorkspaceKeybindings({
    focus,
    dialog,
    pages: closedPages(),
    searchActive: false,
    selectedId: A.id,
    cursorTaskId: () => cursorTaskIdRef.current(),
    openTaskWorktree: (id) => spies.openTaskWorktree.push(id),
    createTask: () => {},
    renameBranch: (id) => spies.renameBranch.push(id),
    cycleVendor: (id) => spies.cycleVendor.push(id),
    toggleZen: () => {},
    jumpToNextAttention: () => {},
    openInbox: () => {},
    enterMoveMode: () => {},
    createPR: () => {},
    createPRFor: () => {},
    fixChecksFor: () => {},
    toggleSortMode: () => {},
  })
  return (
    <SidebarTree
      tasks={[A, B]}
      selectedId={A.id}
      selectedTabId={null}
      onSelect={() => {}}
      focused={focus.focused === "sidebar"}
      width={28}
      cursorTaskIdRef={cursorTaskIdRef}
    />
  )
}

test("b / v / o act on the row under the cursor after a j without enter", async () => {
  const spies: Spies = { renameBranch: [], cycleVendor: [], openTaskWorktree: [] }
  const { mockInput } = await renderComponent(<ChordHost spies={spies} />, {
    width: 28,
    height: 20,
    providers: { focus: true, dialog: true },
  })
  await new Promise((r) => setTimeout(r, SETTLE))

  // Cursor starts on the active row, so with no movement both agree.
  mockInput.typeText("b")
  await new Promise((r) => setTimeout(r, SETTLE))
  expect(spies.renameBranch).toEqual([A.id])

  // `j` moves the cursor to `b` WITHOUT selecting it — the active task is
  // still `a`. Every sidebar-scope row verb must now name `b`.
  mockInput.typeText("j")
  await new Promise((r) => setTimeout(r, SETTLE))
  mockInput.typeText("b")
  await new Promise((r) => setTimeout(r, SETTLE))
  expect(spies.renameBranch).toEqual([A.id, B.id])

  mockInput.typeText("v")
  await new Promise((r) => setTimeout(r, SETTLE))
  expect(spies.cycleVendor).toEqual([B.id])

  mockInput.typeText("o")
  await new Promise((r) => setTimeout(r, SETTLE))
  expect(spies.openTaskWorktree).toEqual([B.id])
})
