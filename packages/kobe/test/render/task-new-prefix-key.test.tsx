/** @jsxImportSource @opentui/react */
/** Real-render coverage for the prefix+n New task chord and the ctrl+n terminal boundary. */

import { describe, expect, it } from "bun:test"
import { useState } from "react"
import { FocusProvider, type PaneId, useFocus } from "../../src/tui-react/context/focus"
import { useBindings } from "../../src/tui-react/lib/keymap"
import { SidebarBrandHeader, SidebarSearchInput } from "../../src/tui-react/panes/sidebar/chrome"
import { useTreeSearch } from "../../src/tui-react/panes/sidebar/use-tree-search"
import { useTerminalBindings } from "../../src/tui-react/panes/terminal/keys"
import { useDialog } from "../../src/tui-react/ui/dialog"
import { useWorkspaceKeybindings } from "../../src/tui-react/workspace/host-keybindings"
import type { HostPagesState } from "../../src/tui-react/workspace/host-pages"
import { resetPrefixState } from "../../src/tui/lib/keymap-dispatch"
import { act, renderComponent, settle } from "./harness"

const NOOP = (): void => {}

type OpenPage = "worktreesOpen" | "updateOpen" | "kanbanOpen" | "automationsOpen" | "workItemsOpen"

function pages(open?: OpenPage): HostPagesState {
  return {
    nav: "terminal",
    setNav: NOOP,
    goToNav: NOOP,
    settingsOpen: false,
    openSettings: NOOP,
    closeSettings: NOOP,
    worktreesOpen: open === "worktreesOpen",
    openWorktrees: NOOP,
    closeWorktrees: NOOP,
    updateOpen: open === "updateOpen",
    openUpdate: NOOP,
    closeUpdate: NOOP,
    kanbanOpen: open === "kanbanOpen",
    openKanban: NOOP,
    closeKanban: NOOP,
    automationsOpen: open === "automationsOpen",
    openAutomations: NOOP,
    closeAutomations: NOOP,
    workItemsOpen: open === "workItemsOpen",
    openWorkItems: NOOP,
    closeWorkItems: NOOP,
  }
}

function TerminalInput(props: { writes: string[] }) {
  useTerminalBindings({
    focused: true,
    unfocusedAttachmentTarget: false,
    write: (data) => props.writes.push(data),
    paste: NOOP,
    scroll: NOOP,
    reset: NOOP,
    searchActive: false,
    openSearch: NOOP,
    stepSearch: NOOP,
    closeSearch: NOOP,
  })
  return <text>engine composer</text>
}

function SearchInput() {
  return <SidebarSearchInput query="" matchCount={0} totalCount={0} />
}

function Driver(props: {
  initialFocus: PaneId
  openPage?: OpenPage
  searchActive?: boolean
  terminalWrites?: string[]
}) {
  const focus = useFocus()
  const dialog = useDialog()
  useWorkspaceKeybindings({
    focus,
    dialog,
    pages: pages(props.openPage),
    filesPaneVisible: true,
    searchActive: props.searchActive ?? false,
    selectedId: null,
    cursorTaskId: () => null,
    openTaskWorktree: NOOP,
    createTask: () => dialog.replace(() => <text>New task dialog opened</text>),
    renameBranch: NOOP,
    cycleVendor: NOOP,
    toggleZen: NOOP,
    jumpToNextAttention: NOOP,
    openInbox: NOOP,
    enterMoveMode: NOOP,
    createPR: NOOP,
    createPRFor: NOOP,
    fixChecksFor: () => {},
    toggleSortMode: NOOP,
  })
  if (props.terminalWrites) return <TerminalInput writes={props.terminalWrites} />
  if (props.searchActive) return <SearchInput />
  return <text>content pane</text>
}

async function pressNewTask(props: Parameters<typeof Driver>[0] & { bareCtrlN?: boolean }): Promise<string> {
  const { frame, mockInput, destroy } = await renderComponent(
    <FocusProvider initial={props.initialFocus}>
      <Driver {...props} />
    </FocusProvider>,
    {
      width: 70,
      height: 20,
      providers: { dialog: true },
    },
  )
  await settle()
  await act(async () => {
    if (props.bareCtrlN) {
      mockInput.pressKey("n", { ctrl: true })
    } else {
      mockInput.pressKey("a", { ctrl: true })
      mockInput.pressKey("n")
    }
    await settle()
  })
  const text = await frame()
  act(() => destroy())
  resetPrefixState()
  return text
}

function SearchSurface(props: { onActiveChange: (active: boolean) => void; onOpenUpdate: () => void }) {
  const search = useTreeSearch({ focused: true, onActiveChange: props.onActiveChange })
  useBindings(() => ({ bindings: [{ key: "/", cmd: search.enter }] }))
  return (
    <box flexDirection="column">
      <text>{search.active ? `/${search.query}` : "sidebar"}</text>
      <SidebarBrandHeader
        focused={true}
        status={{ label: "Inbox 0", emphasize: false }}
        update={{ label: "Update chip" }}
        onUpdateClick={props.onOpenUpdate}
      />
    </box>
  )
}

function SearchUnmountTransition() {
  const focus = useFocus()
  const dialog = useDialog()
  const [updateOpen, setUpdateOpen] = useState(false)
  const [searchActive, setSearchActive] = useState(false)
  useWorkspaceKeybindings({
    focus,
    dialog,
    pages: {
      ...pages(updateOpen ? "updateOpen" : undefined),
      openUpdate: () => setUpdateOpen(true),
      closeUpdate: () => setUpdateOpen(false),
    },
    filesPaneVisible: true,
    searchActive,
    selectedId: null,
    cursorTaskId: () => null,
    openTaskWorktree: NOOP,
    createTask: () => dialog.replace(() => <text>New task dialog opened</text>),
    renameBranch: NOOP,
    cycleVendor: NOOP,
    toggleZen: NOOP,
    jumpToNextAttention: NOOP,
    openInbox: NOOP,
    enterMoveMode: NOOP,
    createPR: NOOP,
    createPRFor: NOOP,
    fixChecksFor: () => {},
    toggleSortMode: NOOP,
  })
  if (updateOpen) {
    return (
      <SidebarBrandHeader
        focused={false}
        status={{ label: "Inbox 0", emphasize: false }}
        update={{ label: "Close Update" }}
        onUpdateClick={() => setUpdateOpen(false)}
      />
    )
  }
  return <SearchSurface onActiveChange={setSearchActive} onOpenUpdate={() => setUpdateOpen(true)} />
}

describe("prefix+n New task", () => {
  it("opens the dialog from sidebar, files, and a non-input content pane", async () => {
    for (const initialFocus of ["sidebar", "files", "workspace"] as const) {
      expect(await pressNewTask({ initialFocus })).toContain("New task dialog opened")
    }
  })

  it("opens the dialog from kanban, routines, and issues pages", async () => {
    for (const openPage of ["kanbanOpen", "automationsOpen", "workItemsOpen"] as const) {
      expect(await pressNewTask({ initialFocus: "workspace", openPage })).toContain("New task dialog opened")
    }
  })

  it("opens the dialog from the Worktrees and Update full-window pages", async () => {
    for (const openPage of ["worktreesOpen", "updateOpen"] as const) {
      expect(await pressNewTask({ initialFocus: "workspace", openPage })).toContain("New task dialog opened")
    }
  })

  it("leaves prefix+n unclaimed while the real sidebar search input is active", async () => {
    const text = await pressNewTask({ initialFocus: "sidebar", searchActive: true })
    expect(text).not.toContain("New task dialog opened")
  })

  it("restores prefix+n after search unmounts behind the Update page", async () => {
    const { frame, mockInput, mockMouse } = await renderComponent(
      <FocusProvider initial="sidebar">
        <SearchUnmountTransition />
      </FocusProvider>,
      { width: 70, height: 20, providers: { dialog: true } },
    )

    await act(async () => {
      await mockInput.typeText("/")
    })
    await settle()
    let text = await frame()
    expect(text).toContain("/")

    const updateRow = text.split("\n").findIndex((line) => line.includes("Update chip"))
    await act(async () => {
      await mockMouse.click(text.split("\n")[updateRow]!.indexOf("Update chip") + 1, updateRow)
    })
    await settle()
    text = await frame()
    expect(text).toContain("Close Update")

    const closeRow = text.split("\n").findIndex((line) => line.includes("Close Update"))
    await act(async () => {
      await mockMouse.click(text.split("\n")[closeRow]!.indexOf("Close Update") + 1, closeRow)
    })
    await settle()
    act(() => {
      mockInput.pressKey("a", { ctrl: true })
      mockInput.pressKey("n")
    })
    await settle()
    expect(await frame()).toContain("New task dialog opened")
    resetPrefixState()
  })

  it("opens over an engine composer via the prefix, while a bare ctrl+n reaches the PTY", async () => {
    const writes: string[] = []
    const opened = await pressNewTask({ initialFocus: "workspace", terminalWrites: writes })
    expect(opened).toContain("New task dialog opened")
    expect(writes).toEqual([])

    const forwarded = await pressNewTask({ initialFocus: "workspace", terminalWrites: writes, bareCtrlN: true })
    expect(forwarded).not.toContain("New task dialog opened")
    expect(forwarded).toContain("engine composer")
    expect(writes).toEqual(["\x0e"])
  })
})
