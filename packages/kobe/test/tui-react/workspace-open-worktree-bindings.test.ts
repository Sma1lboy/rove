import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  bindingFactories: [] as Array<
    () => {
      enabled: boolean
      bindings: Array<{ key: string; prefix?: boolean; cmd: (event: never) => void }>
    }
  >,
}))

// This test exercises the framework-free binding builder exported beside the
// hook. Mock the rendering shell so importing that module under Vitest does
// not load @opentui/react's Bun-only reconciler entrypoint.
vi.mock("@opentui/react", () => ({ useRenderer: vi.fn() }))
vi.mock("../../src/tui-react/component/help-dialog", () => ({ HelpDialog: { show: vi.fn() } }))
vi.mock("../../src/tui-react/i18n", () => ({ useT: () => (key: string) => key }))
vi.mock("../../src/tui-react/lib/keymap", () => ({
  pageCloseBindings: vi.fn(() => []),
  useBindings: vi.fn((factory) => mocks.bindingFactories.push(factory)),
}))
vi.mock("../../src/tui-react/ui/dialog-confirm", () => ({ DialogConfirm: { show: vi.fn() } }))

import type { HostPagesState } from "../../src/tui-react/workspace/host-pages"

const { useWorkspaceKeybindings } = await import("../../src/tui-react/workspace/host-keybindings")

describe("workspace open-worktree bindings", () => {
  beforeEach(() => {
    mocks.bindingFactories.length = 0
  })

  test("the workspace hook registers the sidebar-scoped task bindings", () => {
    const openTaskWorktree = vi.fn()
    const renameBranch = vi.fn()
    const cycleVendor = vi.fn()
    const toggleSortMode = vi.fn()
    const pages: HostPagesState = {
      nav: "terminal",
      setNav: vi.fn(),
      goToNav: vi.fn(),
      settingsOpen: false,
      openSettings: vi.fn(),
      closeSettings: vi.fn(),
      worktreesOpen: false,
      openWorktrees: vi.fn(),
      closeWorktrees: vi.fn(),
      updateOpen: false,
      openUpdate: vi.fn(),
      closeUpdate: vi.fn(),
      kanbanOpen: false,
      openKanban: vi.fn(),
      closeKanban: vi.fn(),
      automationsOpen: false,
      openAutomations: vi.fn(),
      closeAutomations: vi.fn(),
      workItemsOpen: false,
      openWorkItems: vi.fn(),
      closeWorkItems: vi.fn(),
    }
    useWorkspaceKeybindings({
      focus: { focused: "sidebar", setFocused: vi.fn() } as never,
      dialog: { stack: [] } as never,
      pages,
      searchActive: false,
      selectedId: "task-1",
      // The cursor sits on a DIFFERENT row than the active task — the
      // sidebar-scope chords must follow the cursor; the global prefix `o`
      // follows the cursor too while the sidebar has focus.
      cursorTaskId: () => "task-2",
      openTaskWorktree,
      createTask: vi.fn(),
      renameBranch,
      cycleVendor,
      toggleZen: vi.fn(),
      jumpToNextAttention: vi.fn(),
      openInbox: vi.fn(),
      enterMoveMode: vi.fn(),
      createPR: vi.fn(),
      createPRFor: vi.fn(),
      fixChecksFor: vi.fn(),
      syncBaseFor: vi.fn(),
      toggleSortMode,
    })

    const registrations = mocks.bindingFactories.map((factory) => factory())
    const globalOpen = registrations
      .flatMap((registration) => registration.bindings)
      .find((binding) => binding.key === "o" && binding.prefix)
    const sidebarBindings =
      registrations.find((registration) =>
        registration.bindings.some((binding) => binding.key === "b" && !binding.prefix),
      )?.bindings ?? []
    const sidebarOpen = sidebarBindings.find((binding) => binding.key === "o" && !binding.prefix)
    const rename = sidebarBindings.find((binding) => binding.key === "b")
    const cycleEngine = sidebarBindings.find((binding) => binding.key === "v")
    const sort = sidebarBindings.find((binding) => binding.key === "t")

    expect(globalOpen).toBeDefined()
    expect(sidebarOpen).toBeDefined()
    expect(rename).toBeDefined()
    expect(cycleEngine).toBeDefined()
    expect(sort).toBeDefined()
    globalOpen?.cmd({} as never)
    sidebarOpen?.cmd({} as never)
    rename?.cmd({} as never)
    cycleEngine?.cmd({} as never)
    sort?.cmd({} as never)
    expect(openTaskWorktree).toHaveBeenCalledTimes(2)
    expect(openTaskWorktree).toHaveBeenNthCalledWith(1, "task-2")
    expect(openTaskWorktree).toHaveBeenNthCalledWith(2, "task-2")
    expect(renameBranch).toHaveBeenCalledWith("task-2")
    expect(cycleVendor).toHaveBeenCalledWith("task-2")
    expect(toggleSortMode).toHaveBeenCalledTimes(1)
  })

  // Boot now lands focus in the content pane when a session is restorable,
  // so the sidebar-scoped `o` is legitimately dead until ctrl+q comes back.
  // Pinning the gate here keeps that contract visible to anyone driving the
  // TUI from a test: press ctrl+q first, or use the global prefix chord.
  test("the sidebar open-worktree row is gated off while another pane holds focus", () => {
    const pages: HostPagesState = {
      nav: "terminal",
      setNav: vi.fn(),
      goToNav: vi.fn(),
      settingsOpen: false,
      openSettings: vi.fn(),
      closeSettings: vi.fn(),
      worktreesOpen: false,
      openWorktrees: vi.fn(),
      closeWorktrees: vi.fn(),
      updateOpen: false,
      openUpdate: vi.fn(),
      closeUpdate: vi.fn(),
      kanbanOpen: false,
      openKanban: vi.fn(),
      closeKanban: vi.fn(),
      automationsOpen: false,
      openAutomations: vi.fn(),
      closeAutomations: vi.fn(),
      workItemsOpen: false,
      openWorkItems: vi.fn(),
      closeWorkItems: vi.fn(),
    }
    useWorkspaceKeybindings({
      focus: { focused: "workspace", setFocused: vi.fn() } as never,
      dialog: { stack: [] } as never,
      pages,
      searchActive: false,
      selectedId: "task-1",
      cursorTaskId: () => "task-2",
      openTaskWorktree: vi.fn(),
      createTask: vi.fn(),
      renameBranch: vi.fn(),
      cycleVendor: vi.fn(),
      toggleZen: vi.fn(),
      jumpToNextAttention: vi.fn(),
      openInbox: vi.fn(),
      enterMoveMode: vi.fn(),
      createPR: vi.fn(),
      createPRFor: vi.fn(),
      fixChecksFor: vi.fn(),
      syncBaseFor: vi.fn(),
      toggleSortMode: vi.fn(),
    })

    const registrations = mocks.bindingFactories.map((factory) => factory())
    const sidebarRow = registrations.find((registration) =>
      registration.bindings.some((binding) => binding.key === "o" && !binding.prefix),
    )
    expect(sidebarRow?.bindings.find((binding) => binding.key === "o" && !binding.prefix)).toBeDefined()
    expect(sidebarRow?.enabled).toBe(false)
    // The global prefix chord stays reachable from any pane.
    expect(registrations[0]?.enabled).not.toBe(false)
  })

  function makeDeps(over: Partial<Parameters<typeof useWorkspaceKeybindings>[0]> = {}) {
    const pages: HostPagesState = {
      nav: "terminal",
      setNav: vi.fn(),
      goToNav: vi.fn(),
      settingsOpen: false,
      openSettings: vi.fn(),
      closeSettings: vi.fn(),
      worktreesOpen: false,
      openWorktrees: vi.fn(),
      closeWorktrees: vi.fn(),
      updateOpen: false,
      openUpdate: vi.fn(),
      closeUpdate: vi.fn(),
      kanbanOpen: false,
      openKanban: vi.fn(),
      closeKanban: vi.fn(),
      automationsOpen: false,
      openAutomations: vi.fn(),
      closeAutomations: vi.fn(),
      workItemsOpen: false,
      openWorkItems: vi.fn(),
      closeWorkItems: vi.fn(),
    }
    return {
      focus: { focused: "sidebar", setFocused: vi.fn() } as never,
      dialog: { stack: [] } as never,
      pages,
      searchActive: false,
      selectedId: null,
      cursorTaskId: () => null,
      openTaskWorktree: vi.fn(),
      createTask: vi.fn(),
      renameBranch: vi.fn(),
      cycleVendor: vi.fn(),
      toggleZen: vi.fn(),
      jumpToNextAttention: vi.fn(),
      openInbox: vi.fn(),
      enterMoveMode: vi.fn(),
      createPR: vi.fn(),
      createPRFor: vi.fn(),
      fixChecksFor: vi.fn(),
      syncBaseFor: vi.fn(),
      toggleSortMode: vi.fn(),
      ...over,
    }
  }

  function findSidebarPageGroup() {
    return mocks.bindingFactories
      .map((factory) => factory())
      .find((registration) =>
        ["s", "x", "u", "q"].every((key) =>
          registration.bindings.some((binding) => binding.key === key && !binding.prefix),
        ),
      )
  }

  test("sidebar page/quit chords are gated off while the sidebar search box is active", () => {
    useWorkspaceKeybindings(makeDeps({ searchActive: true }))

    const group = findSidebarPageGroup()
    expect(group?.enabled).toBe(false)
    // `s` (settings), `x` (worktrees), `u` (update) and the bare `q` quit
    // chord must all stand down — the raw search listener only sees keys
    // the keymap left unclaimed, so a dispatched `s` never reaches the box.
    for (const key of ["s", "x", "u", "q"]) {
      expect(group?.bindings.find((binding) => binding.key === key && !binding.prefix)).toBeDefined()
    }
  })

  test("the same group is live when the search box is inactive", () => {
    useWorkspaceKeybindings(makeDeps({ searchActive: false }))

    const group = findSidebarPageGroup()
    expect(group?.enabled).toBe(true)
  })

  test("`u` always opens the update page — the page IS the version check", () => {
    // Gating this on the boot-time update signal would make `u` a silent
    // no-op whenever that signal is null: dev mode and a failed/offline
    // registry lookup both answer null, and this chord is the only route
    // to the page. The page re-checks with `force: true` and always offers
    // release notes, so it is never actionless.
    const openUpdate = vi.fn()
    const deps = makeDeps()
    deps.pages = { ...deps.pages, openUpdate }
    useWorkspaceKeybindings(deps)
    const group = findSidebarPageGroup()
    group?.bindings.find((binding) => binding.key === "u")?.cmd({} as never)
    expect(openUpdate).toHaveBeenCalledTimes(1)
  })
})
