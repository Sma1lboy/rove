/** @jsxImportSource @opentui/react */
/** Real-render coverage for ctrl+n's UI-only New task scope. */

import { describe, expect, it } from "bun:test"
import { FocusProvider, type PaneId, useFocus } from "../../src/tui-react/context/focus"
import { useTerminalBindings } from "../../src/tui-react/panes/terminal/keys"
import { useDialog } from "../../src/tui-react/ui/dialog"
import { useWorkspaceKeybindings } from "../../src/tui-react/workspace/host-keybindings"
import type { HostPagesState } from "../../src/tui-react/workspace/host-pages"
import { act, renderComponent, settle } from "./harness"

const NOOP = (): void => {}

function pages(open?: "kanbanOpen" | "automationsOpen" | "workItemsOpen"): HostPagesState {
  return {
    nav: "terminal",
    setNav: NOOP,
    goToNav: NOOP,
    settingsOpen: false,
    openSettings: NOOP,
    closeSettings: NOOP,
    worktreesOpen: false,
    openWorktrees: NOOP,
    closeWorktrees: NOOP,
    updateOpen: false,
    openUpdate: NOOP,
    closeUpdate: NOOP,
    kanbanOpen: open === "kanbanOpen",
    openKanban: NOOP,
    closeKanban: NOOP,
    automationsOpen: open === "automationsOpen",
    openAutomations: NOOP,
    closeAutomations: NOOP,
    agentsOpen: false,
    openAgents: NOOP,
    closeAgents: NOOP,
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
  })
  return <text>engine composer</text>
}

function Driver(props: {
  initialFocus: PaneId
  openPage?: "kanbanOpen" | "automationsOpen" | "workItemsOpen"
  terminalWrites?: string[]
}) {
  const focus = useFocus()
  const dialog = useDialog()
  useWorkspaceKeybindings({
    focus,
    dialog,
    pages: pages(props.openPage),
    filesPaneVisible: true,
    searchActive: false,
    selectedId: null,
    openTaskWorktree: NOOP,
    createTask: () => dialog.replace(() => <text>New task dialog opened</text>),
    renameBranch: NOOP,
    cycleVendor: NOOP,
    toggleZen: NOOP,
    jumpToNextAttention: NOOP,
    openInbox: NOOP,
    enterMoveMode: NOOP,
    createPR: NOOP,
    toggleSortMode: NOOP,
  })
  return props.terminalWrites ? <TerminalInput writes={props.terminalWrites} /> : <text>content pane</text>
}

async function pressCtrlN(props: Parameters<typeof Driver>[0]): Promise<string> {
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
    mockInput.pressKey("n", { ctrl: true })
    await settle()
  })
  const text = await frame()
  act(() => destroy())
  return text
}

describe("ctrl+n New task", () => {
  it("opens the dialog from sidebar, files, and a non-input content pane", async () => {
    for (const initialFocus of ["sidebar", "files", "workspace"] as const) {
      expect(await pressCtrlN({ initialFocus })).toContain("New task dialog opened")
    }
  })

  it("opens the dialog from kanban, routines, and issues pages", async () => {
    for (const openPage of ["kanbanOpen", "automationsOpen", "workItemsOpen"] as const) {
      expect(await pressCtrlN({ initialFocus: "workspace", openPage })).toContain("New task dialog opened")
    }
  })

  it("does not open over an engine composer or terminal and forwards ctrl+n", async () => {
    const writes: string[] = []
    const text = await pressCtrlN({ initialFocus: "workspace", terminalWrites: writes })
    expect(text).not.toContain("New task dialog opened")
    expect(text).toContain("engine composer")
    expect(writes).toEqual(["\x0e"])
  })
})
