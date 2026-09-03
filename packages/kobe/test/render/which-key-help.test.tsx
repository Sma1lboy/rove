/** @jsxImportSource @opentui/react */
/** Real-render coverage for the prefix guide and its F1 reference view. */

import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HelpDialog } from "../../src/tui-react/component/help-dialog"
import { PrefixHud } from "../../src/tui-react/component/prefix-hud"
import { ShortcutRevealProvider } from "../../src/tui-react/component/shortcut-reveal"
import { useFocus } from "../../src/tui-react/context/focus"
import { useBindings } from "../../src/tui-react/lib/keymap"
import { useDialog } from "../../src/tui-react/ui/dialog"
import { useWorkspaceKeybindings } from "../../src/tui-react/workspace/host-keybindings"
import type { HostPagesState } from "../../src/tui-react/workspace/host-pages"
import { bindByIds } from "../../src/tui/context/keybindings"
import { CTRL_HOLD_THRESHOLD_MS } from "../../src/tui/lib/ctrl-hold"
import {
  PREFIX_GUIDE_DELAY_MS,
  prefixHudPush,
  prefixHudSetArmed,
  prefixHudShowDirect,
  resetPrefixHud,
} from "../../src/tui/lib/prefix-hud"
import { PREFIX_TAP_PRESENTATION_KEY } from "../../src/tui/lib/prefix-tap-presentation"
import { DIRECT_GUIDE_PREFIX_ACTION_ID } from "../../src/tui/lib/shortcut-reveal"
import { act, renderComponent, settle, waitForFrameText } from "./harness"

const NOOP = (): void => {}

async function waitForFrameWithoutText(frame: () => Promise<string>, text: string): Promise<string> {
  const deadline = Date.now() + 5_000
  let current = await frame()
  while (current.includes(text)) {
    if (Date.now() >= deadline) throw new Error(`frame still contained ${JSON.stringify(text)}:\n${current}`)
    await settle(25)
    current = await frame()
  }
  return current
}

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

function WorkspaceHelpDriver(props: { showDialogTarget?: boolean; showFocusTarget?: boolean } = {}) {
  const focus = useFocus()
  const dialog = useDialog()
  useWorkspaceKeybindings({
    focus,
    dialog,
    pages: CLOSED_PAGES,
    filesPaneVisible: true,
    searchActive: false,
    selectedId: null,
    cursorTaskId: () => null,
    openTaskWorktree: NOOP,
    createTask: NOOP,
    renameBranch: NOOP,
    cycleVendor: NOOP,
    toggleZen: NOOP,
    jumpToNextAttention: NOOP,
    openInbox: NOOP,
    enterMoveMode: NOOP,
    createPR: NOOP,
    createPRFor: NOOP,
    fixChecksFor: () => {},
    syncBaseFor: () => {},
    toggleSortMode: NOOP,
  })
  return (
    <box flexDirection="column">
      <text>workspace base</text>
      {props.showFocusTarget ? (
        <box onMouseUp={() => focus.setFocused("workspace")}>
          <text>focus workspace</text>
        </box>
      ) : null}
      {props.showDialogTarget ? (
        <box onMouseUp={() => HelpDialog.show(dialog, focus.focused)}>
          <text>open modal</text>
        </box>
      ) : null}
    </box>
  )
}

function ProductionDirectGuideDriver() {
  useBindings(() => ({
    bindings: bindByIds({
      "focus.sidebar": NOOP,
      "chat.tab.new": NOOP,
      "chat.tab.chooseEngine": NOOP,
      "chat.tab.close": NOOP,
      "chat.tab.cycle-next": NOOP,
      "chat.tab.cycle-prev": NOOP,
      "workspace.split.right": NOOP,
      "workspace.split.down": NOOP,
      "terminal.scroll-up": NOOP,
      "terminal.scroll-down": NOOP,
      "kanban.open": NOOP,
    }),
  }))
  return (
    <>
      <text>production direct guide</text>
      <PrefixHud left={1} width={22} />
    </>
  )
}

function locate(frame: string, needle: string): { x: number; y: number } {
  const rows = frame.split("\n")
  const y = rows.findIndex((row) => row.includes(needle))
  if (y < 0) throw new Error(`missing ${needle}`)
  return { x: rows[y]?.indexOf(needle) ?? 0, y }
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

  it("uses a direct-shortcut title while ctrl is held", async () => {
    prefixHudShowDirect([
      { stroke: "q", action: "focus.sidebar" },
      { stroke: "a", action: DIRECT_GUIDE_PREFIX_ACTION_ID },
    ])
    const { frame } = await renderComponent(<PrefixHud left={1} width={22} />, {
      width: 100,
      height: 28,
    })

    const text = await frame()
    expect(text).toContain("Hold ctrl — Rove shortcuts")
    expect(text).toContain("release ctrl to close")
    expect(text).toContain("q")
    expect(text).not.toContain("ctrl+q")
    expect(text).toContain("More commands (prefix)")
  })

  it("keeps every alias visible when a direct action has many chords", async () => {
    prefixHudShowDirect([
      { stroke: "ctrl+2", action: "tasks.jump" },
      { stroke: "ctrl+3", action: "tasks.jump" },
      { stroke: "ctrl+4", action: "tasks.jump" },
      { stroke: "ctrl+5", action: "tasks.jump" },
      { stroke: "ctrl+6", action: "tasks.jump" },
      { stroke: "ctrl+7", action: "tasks.jump" },
      { stroke: "ctrl+8", action: "tasks.jump" },
      { stroke: "ctrl+9", action: "tasks.jump" },
      { stroke: "ctrl+0", action: "tasks.jump" },
    ])
    const { frame } = await renderComponent(<PrefixHud left={1} width={22} />, {
      width: 100,
      height: 28,
    })

    expect(await frame()).toContain("ctrl+0")
  })

  it("opens from a bare ctrl press and closes on its release event", async () => {
    const { frame, mockInput } = await renderComponent(
      <>
        <WorkspaceHelpDriver />
        <PrefixHud left={1} width={22} />
      </>,
      { width: 110, height: 30, providers: { focus: true, dialog: true } },
    )

    act(() => mockInput.pressKey("\x1b[57442;5u"))
    const held = await waitForFrameText(frame, "Hold ctrl — Rove shortcuts", {
      timeoutMs: CTRL_HOLD_THRESHOLD_MS + 5_000,
    })
    expect(held).toContain("More commands (prefix)")
    expect(held).not.toContain("f1")

    act(() => mockInput.pressKey("\x1b[57442;1:3u"))
    await settle()
    expect(await frame()).not.toContain("Hold ctrl — Rove shortcuts")
  })

  it("closes the direct guide after mouse focus changes reachability", async () => {
    const { frame, mockInput, mockMouse } = await renderComponent(
      <>
        <WorkspaceHelpDriver showFocusTarget />
        <PrefixHud left={1} width={22} />
      </>,
      { width: 110, height: 30, providers: { focus: true, dialog: true } },
    )

    act(() => mockInput.pressKey("\x1b[57442;5u"))
    const held = await waitForFrameText(frame, "Hold ctrl — Rove shortcuts", {
      timeoutMs: CTRL_HOLD_THRESHOLD_MS + 5_000,
    })
    expect(held).not.toContain("Back to sidebar")

    const target = locate(held, "focus workspace")
    await mockMouse.click(target.x + 1, target.y)
    expect(await waitForFrameWithoutText(frame, "Hold ctrl — Rove shortcuts")).not.toContain(
      "Hold ctrl — Rove shortcuts",
    )
  })

  it("closes the direct guide when a mouse action opens a modal", async () => {
    const { frame, mockInput, mockMouse } = await renderComponent(
      <>
        <WorkspaceHelpDriver showDialogTarget />
        <PrefixHud left={1} width={22} />
      </>,
      { width: 110, height: 30, providers: { focus: true, dialog: true } },
    )

    act(() => mockInput.pressKey("\x1b[57442;5u"))
    const held = await waitForFrameText(frame, "Hold ctrl — Rove shortcuts", {
      timeoutMs: CTRL_HOLD_THRESHOLD_MS + 5_000,
    })

    const target = locate(held, "open modal")
    await mockMouse.click(target.x + 1, target.y)
    expect(await waitForFrameWithoutText(frame, "Hold ctrl — Rove shortcuts")).not.toContain(
      "Hold ctrl — Rove shortcuts",
    )
  })

  it.each([
    { width: 60, height: 20 },
    { width: 50, height: 20 },
  ])("bounds the production direct guide at $width×$height", async ({ width, height }) => {
    const { frame, mockInput } = await renderComponent(<ProductionDirectGuideDriver />, { width, height })

    act(() => mockInput.pressKey("\x1b[57442;5u"))
    const held = await waitForFrameText(frame, "Hold ctrl", {
      timeoutMs: CTRL_HOLD_THRESHOLD_MS + 5_000,
    })
    expect(held).toContain("F1 for all shortcuts")
    const rows = held.split("\n")
    const overflowRow = rows.findIndex((row) => row.includes("F1 for all shortcuts"))
    const bottomBorderRow = rows.findIndex((row) => row.includes("╰"))
    expect(bottomBorderRow).toBeGreaterThan(overflowRow)
    expect(bottomBorderRow).toBeLessThan(height)
  })
})
