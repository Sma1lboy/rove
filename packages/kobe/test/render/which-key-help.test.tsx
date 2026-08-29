/** @jsxImportSource @opentui/react */
/** Real-render coverage for the prefix guide and its F1 reference view. */

import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrefixHud } from "../../src/tui-react/component/prefix-hud"
import { ShortcutRevealProvider } from "../../src/tui-react/component/shortcut-reveal"
import { useFocus } from "../../src/tui-react/context/focus"
import { useDialog } from "../../src/tui-react/ui/dialog"
import { useWorkspaceKeybindings } from "../../src/tui-react/workspace/host-keybindings"
import type { HostPagesState } from "../../src/tui-react/workspace/host-pages"
import { PREFIX_GUIDE_DELAY_MS, prefixHudPush, prefixHudSetArmed, resetPrefixHud } from "../../src/tui/lib/prefix-hud"
import { PREFIX_TAP_PRESENTATION_KEY } from "../../src/tui/lib/prefix-tap-presentation"
import { act, renderComponent, settle } from "./harness"

const NOOP = (): void => {}

function useGuidePreference(): void {
  const home = mkdtempSync(join(tmpdir(), "rove-which-key-"))
  const configDir = join(home, ".config", "rove")
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, "state.json"), JSON.stringify({ [PREFIX_TAP_PRESENTATION_KEY]: "guide" }))
  process.env.KOBE_HOME_DIR = home
}

const CLOSED_PAGES: HostPagesState = {
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
  kanbanOpen: false,
  openKanban: NOOP,
  closeKanban: NOOP,
  automationsOpen: false,
  openAutomations: NOOP,
  closeAutomations: NOOP,
  workItemsOpen: false,
  openWorkItems: NOOP,
  closeWorkItems: NOOP,
}

function WorkspaceHelpDriver() {
  const focus = useFocus()
  const dialog = useDialog()
  useWorkspaceKeybindings({
    focus,
    dialog,
    pages: CLOSED_PAGES,
    filesPaneVisible: true,
    searchActive: false,
    selectedId: null,
    openTaskWorktree: NOOP,
    createTask: NOOP,
    renameBranch: NOOP,
    cycleVendor: NOOP,
    toggleZen: NOOP,
    jumpToNextAttention: NOOP,
    openInbox: NOOP,
    enterMoveMode: NOOP,
    createPR: NOOP,
  })
  return <text>workspace base</text>
}

afterEach(() => act(() => resetPrefixHud()))

describe("F1 keyboard reference", () => {
  it("opens from the workspace stack and leads with focus-aware grammar", async () => {
    const { frame, mockInput } = await renderComponent(<WorkspaceHelpDriver />, {
      width: 110,
      height: 36,
      providers: { focus: true, dialog: true },
    })

    act(() => mockInput.pressKey("F1"))
    await settle()
    const text = await frame()
    expect(text).toContain("Rove — keybindings")
    expect(text).toContain("Focused: Sidebar")
    expect(text).toContain("ONE PRESS")
    expect(text).toContain("AFTER PREFIX")
  })
})

describe("which-key prefix guide", () => {
  it("stays compact for a fast sequence", async () => {
    useGuidePreference()
    prefixHudSetArmed(true, [{ stroke: "f", action: "chat.fork.new" }], Date.now() + 10_000)
    const { frame } = await renderComponent(
      <ShortcutRevealProvider>
        <PrefixHud left={1} width={22} />
      </ShortcutRevealProvider>,
      { width: 80, height: 24, providers: { kv: true } },
    )
    const text = await frame()
    expect(text).toContain("ctrl+a ⋯")
    expect(text).not.toContain("more Rove commands")
  })

  it("expands reachable commands after the learner delay", async () => {
    useGuidePreference()
    prefixHudSetArmed(
      true,
      [
        { stroke: "f", action: "chat.fork.new" },
        { stroke: "p", action: "files.createPR" },
        { stroke: "P", action: "files.createPR" },
        { stroke: "1", action: "kanban.open" },
        { stroke: ",", action: "settings.open.sidebar" },
      ],
      Date.now() - PREFIX_GUIDE_DELAY_MS,
    )
    const { frame } = await renderComponent(
      <ShortcutRevealProvider>
        <PrefixHud left={1} width={22} />
      </ShortcutRevealProvider>,
      { width: 120, height: 30, providers: { kv: true } },
    )
    const text = await frame()
    expect(text).toContain("ctrl+a — more Rove commands")
    expect(text).toContain("Views")
    expect(text).toContain("Tasks")
    expect(text).toContain("Tools")
    expect(text).toContain("p/P")
    expect(text).toContain("Ask the agent to create a PR from the current task")
  })

  it("renders the resolved-action feed on the readable dialog surface", async () => {
    prefixHudPush({ prefixKey: "ctrl+a", stroke: "f", action: "chat.fork.new", at: Date.now() })
    const { frame, spans } = await renderComponent(<PrefixHud left={1} width={28} />, { width: 80, height: 24 })
    expect(await frame()).toContain("ctrl+a + f")
    const backgrounds = (await spans()).lines.flatMap((line) => line.spans).filter((span) => span.bg !== undefined)
    expect(backgrounds.length).toBeGreaterThan(0)
  })
})
