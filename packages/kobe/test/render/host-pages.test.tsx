/** @jsxImportSource @opentui/react */
/**
 * Coverage for the workspace host's page-render decisions.
 *
 * `host-pages.tsx` was extracted from `host.tsx` to stay under the file-size
 * cap. Its exported render helpers are pure functions over `HostPageDeps`, so
 * they can be mounted in the render track with the same fake-orchestrator
 * pattern already used for the individual page components.
 *
 * This file intentionally exercises the routing layer (which page is rendered
 * for which open flag) rather than duplicating the per-page interaction tests
 * that live next to each page component.
 */

import { expect, test } from "bun:test"
import { useEffect, useRef } from "react"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import type { FocusContextValue } from "../../src/tui-react/context/focus"
import type { KVContext } from "../../src/tui-react/context/kv"
import type { DialogContext } from "../../src/tui-react/ui/dialog"
import {
  type HostPageDeps,
  type HostPagesState,
  renderContentPage,
  renderFullWindowPage,
  useHostPagesRender,
  useHostPagesState,
} from "../../src/tui-react/workspace/host-pages"
import type { Task } from "../../src/types/task"
import { act, renderComponent } from "./harness"

// UpdatePage reaches the npm registry on mount unless this hook is set.
process.env.KOBE_FAKE_UPDATE = "99.0.0"

const WT_ROW = {
  repo: "/x/kobe",
  path: "/x/wt/feature-a",
  branch: "feature-a",
  head: "abc1234",
  dirty: false,
  kobeManaged: true,
  lastActivityMs: 0,
  createdAtMs: 0,
  branchOnRemote: false,
  verdict: "fresh",
  verdictReason: "fresh",
}

const SELECTED_TASK = { id: "t1", repo: "/x/kobe" } as unknown as Task

function fakeOrchestrator(): RemoteOrchestrator {
  return {
    listWorktrees: async (opts?: { network?: boolean }) => [
      { repo: "/x/kobe", worktrees: opts?.network === false ? [WT_ROW] : [WT_ROW] },
    ],
    listTasks: () => [SELECTED_TASK],
    listAutomations: async () => ({ automations: [], keepsDaemonAlive: false }),
    automationRuns: async () => ({ runs: [] }),
    listIssues: async () => ({ repoRoot: "/x/kobe", exists: true, nextId: 99, issues: [] }),
    listWorkItems: async () => ({ items: [] }),
    activeTaskSignal: () => ({ get: () => null }),
  } as unknown as RemoteOrchestrator
}

function deps(overrides: Partial<HostPageDeps>): HostPageDeps {
  return {
    orchestrator: fakeOrchestrator(),
    selectedTask: undefined,
    worktreesOpen: false,
    automationsOpen: false,
    workItemsOpen: false,
    kanbanOpen: false,
    updateOpen: false,
    closeWorktrees: () => {},
    closeAutomations: () => {},
    closeWorkItems: () => {},
    closeKanban: () => {},
    closeUpdate: () => {},
    activateTask: () => {},
    contentFocused: true,
    startIssueChat: async () => {},
    engineStates: new Map(),
    ...overrides,
  }
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 120))

test("renderFullWindowPage returns null when no full-window page is open", async () => {
  const { frame } = await renderComponent(<box>{renderFullWindowPage(deps({}))}</box>, {
    width: 80,
    height: 24,
  })
  expect(await frame()).not.toContain("Worktrees")
  expect(await frame()).not.toContain("ROVE UPDATE")
})

test("renderFullWindowPage renders WorktreesPage", async () => {
  const { frame } = await renderComponent(<box>{renderFullWindowPage(deps({ worktreesOpen: true }))}</box>, {
    width: 70,
    height: 20,
    providers: { dialog: true },
  })
  await settle()
  expect(await frame()).toContain("Worktrees")
})

test("renderFullWindowPage renders UpdatePage", async () => {
  const { frame } = await renderComponent(<box>{renderFullWindowPage(deps({ updateOpen: true }))}</box>, {
    width: 80,
    height: 24,
  })
  await settle()
  expect(await frame()).toContain("ROVE UPDATE")
})

test("renderContentPage returns null when no content page is open", async () => {
  const { frame } = await renderComponent(<box>{renderContentPage(deps({}))}</box>, {
    width: 80,
    height: 24,
    providers: { dialog: true },
  })
  await settle()
  expect(await frame()).not.toContain("ROUTINES")
})

test("renderContentPage renders AutomationsPage with focus repo", async () => {
  const { frame } = await renderComponent(
    <box>{renderContentPage(deps({ automationsOpen: true, selectedTask: SELECTED_TASK }))}</box>,
    {
      width: 70,
      height: 16,
      providers: { dialog: true },
    },
  )
  await settle()
  expect(await frame()).toContain("ROUTINES")
})

test("renderContentPage renders WorkItemsPage with a selected task repo", async () => {
  const { frame } = await renderComponent(
    <box>{renderContentPage(deps({ workItemsOpen: true, selectedTask: SELECTED_TASK }))}</box>,
    {
      width: 80,
      height: 24,
      providers: { dialog: true },
    },
  )
  await settle()
  expect(await frame()).toContain("ISSUES")
})

test("renderContentPage renders KanbanPage with a focus task", async () => {
  const { frame } = await renderComponent(
    <box>{renderContentPage(deps({ kanbanOpen: true, selectedTask: SELECTED_TASK }))}</box>,
    {
      width: 120,
      height: 30,
      providers: { dialog: true, kv: true, notifications: true },
    },
  )
  await settle()
  expect(await frame()).toContain("Kanban")
})

test("renderContentPage renders AutomationsPage without a selected task", async () => {
  const { frame } = await renderComponent(<box>{renderContentPage(deps({ automationsOpen: true }))}</box>, {
    width: 70,
    height: 16,
    providers: { dialog: true },
  })
  await settle()
  expect(await frame()).toContain("ROUTINES")
})

test("renderContentPage renders WorkItemsPage without a selected task", async () => {
  const { frame } = await renderComponent(<box>{renderContentPage(deps({ workItemsOpen: true }))}</box>, {
    width: 80,
    height: 24,
    providers: { dialog: true },
  })
  await settle()
  expect(await frame()).toContain("ISSUES")
})

test("renderContentPage renders KanbanPage without a focus task", async () => {
  const { frame } = await renderComponent(<box>{renderContentPage(deps({ kanbanOpen: true }))}</box>, {
    width: 120,
    height: 30,
    providers: { dialog: true, kv: true, notifications: true },
  })
  await settle()
  expect(await frame()).toContain("Kanban")
})

function mockFocus(): FocusContextValue {
  return {
    focused: "sidebar",
    is: () => false,
    setFocused: () => {},
    cycle: () => {},
  }
}

function mockDialog(): DialogContext {
  return {
    stack: [],
    replace: () => {},
    push: () => {},
    pop: () => {},
    clear: () => {},
    size: "medium",
    setSize: () => {},
    placement: "center",
    setPlacement: () => {},
  }
}

function mockKv(): KVContext {
  return {
    ready: true,
    store: {},
    signal: (name, defaultValue) => [() => defaultValue, () => {}],
    get: () => undefined,
    set: () => {},
    flush: () => true,
    clear: () => {},
  }
}

test("useHostPagesState opens and closes rail pages", async () => {
  let pagesRef: HostPagesState | null = null
  function StateHarness() {
    pagesRef = useHostPagesState(mockFocus())
    return <text>{pagesRef.nav}</text>
  }
  const { frame } = await renderComponent(<StateHarness />)
  expect(await frame()).toContain("terminal")
  act(() => pagesRef?.openKanban())
  await settle()
  expect(await frame()).toContain("kanban")
  act(() => pagesRef?.closeKanban())
  await settle()
  expect(await frame()).toContain("terminal")
  act(() => pagesRef?.openAutomations())
  await settle()
  expect(await frame()).toContain("automations")
  act(() => pagesRef?.openWorkItems())
  await settle()
  expect(await frame()).toContain("issues")
  act(() => pagesRef?.openWorktrees())
  await settle()
  expect(pagesRef!.worktreesOpen).toBe(true)
  act(() => pagesRef?.closeWorktrees())
  await settle()
  expect(pagesRef!.worktreesOpen).toBe(false)
  act(() => pagesRef?.openUpdate())
  await settle()
  expect(pagesRef!.updateOpen).toBe(true)
})

function RenderHarness(props: { width: number; initial?: (pages: HostPagesState) => void }) {
  const focus = mockFocus()
  const pages = useHostPagesState(focus)
  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    props.initial?.(pages)
  }, [props.initial, pages])

  const render = useHostPagesRender({
    orchestrator: fakeOrchestrator(),
    pages,
    focus,
    dialog: mockDialog(),
    kv: mockKv(),
    dims: { width: props.width },
    selectedTask: SELECTED_TASK,
    activeTaskId: "t1",
    tasks: [SELECTED_TASK],
    engineState: new Map(),
    startIssueChat: async () => {},
    activateTask: () => {},
  })

  return (
    <box>
      {render.settingsPage}
      {render.fullWindowPage}
      {render.contentPage}
      <text>{render.showSidebar ? "showSidebar" : "hideSidebar"}</text>
      <text>{render.showContent ? "showContent" : "hideContent"}</text>
      <text>{render.recentTask ? `recent:${render.recentTask.id}` : "norecent"}</text>
    </box>
  )
}

test("useHostPagesRender surfaces the settings page", async () => {
  const { frame } = await renderComponent(<RenderHarness width={80} initial={(pages) => pages.openSettings()} />, {
    width: 80,
    height: 24,
  })
  await settle()
  expect(await frame()).toContain("Settings")
})

test("useHostPagesRender surfaces a full-window page", async () => {
  const { frame } = await renderComponent(<RenderHarness width={80} initial={(pages) => pages.openWorktrees()} />, {
    width: 80,
    height: 24,
  })
  await settle()
  expect(await frame()).toContain("Worktrees")
})

test("useHostPagesRender surfaces a content page", async () => {
  const { frame } = await renderComponent(<RenderHarness width={80} initial={(pages) => pages.openKanban()} />, {
    width: 120,
    height: 30,
    providers: { dialog: true, kv: true, notifications: true },
  })
  await settle()
  expect(await frame()).toContain("Kanban")
})

test("useHostPagesRender computes narrow layout and recent task", async () => {
  const { frame } = await renderComponent(<RenderHarness width={40} initial={(pages) => pages.openKanban()} />, {
    width: 40,
    height: 24,
    providers: { dialog: true, kv: true, notifications: true },
  })
  await settle()
  const text = await frame()
  // Narrow mode with a content page open shows the sidebar rail only.
  expect(text).toContain("showSidebar")
  expect(text).toContain("hideContent")
  expect(text).toContain("recent:t1")
})
