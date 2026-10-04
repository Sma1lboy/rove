/** @jsxImportSource @opentui/react */
/**
 * The `t` sort chord, pressed for real, through the REAL cycle.
 *
 * Two hops have to be right and neither shows up in a still frame: the
 * WORKSPACE host owns the binding (`useWorkspaceKeybindings` → `toggleSortMode`
 * → the `sortMode` prop; the SidebarTree only renders the order it is given),
 * and `useSidebarHostState` owns which mode comes next. So this mounts both
 * real hooks next to the real tree and asserts the frame's row order after
 * each press. A frame-only probe can't catch a dead chord — a binding that was
 * never registered renders identically to one that works — and a locally
 * re-implemented toggle would pass while the product's cycle was wrong.
 */
import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { TaskEngineState } from "../../src/client/remote-orchestrator"
import { useFocus } from "../../src/tui-react/context/focus"
import { useKV } from "../../src/tui-react/context/kv"
import { SidebarTree } from "../../src/tui-react/panes/sidebar/SidebarTree"
import { useSidebarHostState } from "../../src/tui-react/panes/sidebar/use-sidebar-host-state"
import { useDialog } from "../../src/tui-react/ui/dialog"
import { useWorkspaceKeybindings } from "../../src/tui-react/workspace/host-keybindings"
import type { HostPagesState } from "../../src/tui-react/workspace/host-pages"
import type { Task } from "../../src/types/task"
import { toTaskId } from "../../src/types/task"
import { renderComponent } from "./harness"

const SETTLE = 80

// `useSidebarHostState` PERSISTS the chosen sort through KVProvider, which
// writes `$ROVE_HOME_DIR/.config/rove/state.json` — the real ~/.rove without
// this. Captured once per FILE: bun runs a file in one process, and a
// `beforeEach` snapshot would restore whatever the previous file left behind.
let previousHome: string | undefined

beforeAll(() => {
  previousHome = process.env.ROVE_HOME_DIR
  process.env.ROVE_HOME_DIR = mkdtempSync(join(tmpdir(), "rove-sort-key-"))
})

afterAll(() => {
  if (previousHome === undefined) Reflect.deleteProperty(process.env, "ROVE_HOME_DIR")
  else process.env.ROVE_HOME_DIR = previousHome
})

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

/**
 * One project whose regular worktrees sit in stored order by default. `aaa` is
 * the OLDEST, the one that is BLOCKED, and titled to sort LAST by name, so each
 * stop of the cycle puts the two rows in an unambiguous order:
 *   default   aaa, zzz  (stored)
 *   recent    zzz, aaa  (zzz touched later)
 *   attention aaa, zzz  (aaa is stuck; zzz is quiet)
 *   name      zzz, aaa  ("Apple" before "Zebra")
 * Neighbouring stops always disagree, so walking the whole cycle proves each
 * press advanced exactly one step.
 */
const MAIN = task("m", { kind: "main", branch: "", worktreePath: "/repos/rove" })
const OLDER = task("aaa", { title: "Zebra", updatedAt: "2026-08-01T00:00:00.000Z" })
const NEWER = task("zzz", { title: "Apple", updatedAt: "2026-08-20T00:00:00.000Z" })

const BLOCKED: ReadonlyMap<string, TaskEngineState> = new Map([
  [OLDER.id, { state: "permission_needed", at: Date.now() }],
])

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
    whatsNewFrom: null,
    closeWhatsNew: noop,
    welcome: null,
    closeWelcome: noop,
  }
}

/** The real binding hook and the real sort-mode state, minus the app. */
function SortHost() {
  const focus = useFocus()
  const dialog = useDialog()
  const kv = useKV()
  const { sortMode, toggleSortMode } = useSidebarHostState({
    kv,
    tasks: [MAIN, OLDER, NEWER],
    focusSidebar: () => {},
  })
  useWorkspaceKeybindings({
    focus,
    dialog,
    pages: closedPages(),
    searchActive: false,
    selectedId: OLDER.id,
    cursorTaskId: () => null,
    openTaskWorktree: () => {},
    createTask: () => {},
    renameBranch: () => {},
    cycleVendor: () => {},
    toggleZen: () => {},
    jumpToNextAttention: () => {},
    openInbox: () => {},
    enterMoveMode: () => {},
    createPR: () => {},
    createPRFor: () => {},
    fixChecksFor: () => {},
    syncBaseFor: () => {},
    toggleSortMode,
  })
  return (
    <SidebarTree
      tasks={[MAIN, OLDER, NEWER]}
      selectedId={OLDER.id}
      selectedTabId={null}
      onSelect={() => {}}
      focused={focus.focused === "sidebar"}
      sortMode={sortMode}
      engineState={BLOCKED}
      width={28}
    />
  )
}

/** Negative when `aaa` renders above `zzz`. */
function orderOf(frame: string): number {
  return frame.indexOf("feat/aaa") - frame.indexOf("feat/zzz")
}

test("t cycles the sidebar through default → recent → attention → name", async () => {
  const { frame, mockInput } = await renderComponent(<SortHost />, {
    width: 28,
    height: 20,
    providers: { focus: true, dialog: true, kv: true },
  })
  await new Promise((r) => setTimeout(r, SETTLE))
  const press = async (): Promise<number> => {
    mockInput.typeText("t")
    await new Promise((r) => setTimeout(r, SETTLE))
    return orderOf(await frame())
  }

  // Default sort keeps the stored order: aaa before zzz.
  expect(orderOf(await frame())).toBeLessThan(0)
  // Recency: zzz (touched later) jumps above aaa.
  expect(await press()).toBeGreaterThan(0)
  // Attention: aaa is the blocked one, so it returns to the top despite being older.
  expect(await press()).toBeLessThan(0)
  // Name: "Apple" (zzz) sorts above "Zebra" (aaa).
  expect(await press()).toBeGreaterThan(0)
  // Wraps home rather than latching on the last mode…
  expect(await press()).toBeLessThan(0)
  // …and the next press is `recent` again, so the wrap landed on `default`.
  expect(await press()).toBeGreaterThan(0)
})
