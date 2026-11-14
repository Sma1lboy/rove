/** @jsxImportSource @opentui/react */
/**
 * The tab strip's right-click menu, driven by a REAL right-click through the
 * renderer: button 2 has to survive the mouse pipeline onto a tab box, and
 * the menu's verbs must act on the tab that was clicked, not the one that
 * was active before.
 */

import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { act, useState } from "react"
import { TAB_STRIP_MODE_KEY } from "../../src/state/tab-strip"
import { useBindings } from "../../src/tui-react/lib/keymap"
import { TabStrip } from "../../src/tui-react/workspace/tab-strip"
import { useTabStripMenu } from "../../src/tui-react/workspace/use-tab-strip-menu"
import type { TerminalTab } from "../../src/tui/workspace/terminal-tabs-core"
import { renderComponent, settle, waitForFrameText } from "./harness"

process.env.ROVE_HOME_DIR ??= mkdtempSync(join(tmpdir(), "rove-tab-strip-menu-"))
mkdirSync(join(process.env.ROVE_HOME_DIR, ".config", "rove"), { recursive: true })
writeFileSync(
  join(process.env.ROVE_HOME_DIR, ".config", "rove", "state.json"),
  JSON.stringify({ [TAB_STRIP_MODE_KEY]: "always" }),
)

const RIGHT = 2

function Driver(props: {
  tabs: readonly TerminalTab[]
  onRename: (activeId: string) => void
  onContinue?: (activeId: string) => void
  onClose?: (activeId: string) => void
  controls?: { select?: (id: string) => void; remove?: () => void }
}) {
  const [removed, setRemoved] = useState(false)
  const tabs = removed ? props.tabs.slice(0, 1) : props.tabs
  const [activeId, setActiveId] = useState(props.tabs[0]?.id ?? "")
  if (props.controls) {
    props.controls.select = setActiveId
    props.controls.remove = () => setRemoved(true)
  }
  useBindings(() => ({ bindings: [{ key: "ctrl+]", cmd: () => setActiveId("tab-1") }] }))
  const menu = useTabStripMenu({
    taskId: "alpha",
    tabs,
    activeId,
    select: setActiveId,
    rename: () => props.onRename(activeId),
    continueEngine: () => props.onContinue?.(activeId),
    closeActive: () => props.onClose?.(activeId),
  })
  return (
    <box ref={menu.anchorRef} flexDirection="column" flexGrow={1}>
      <TabStrip
        taskId="alpha"
        tabs={tabs}
        activeId={activeId}
        onSelect={setActiveId}
        onContextMenu={menu.openForTab}
        vendor="claude"
        liveTitles={new Map()}
        turnVendors={new Map()}
      />
      <box flexGrow={1} />
      {menu.overlay}
    </box>
  )
}

/** Screen cell of the first occurrence of `needle`. */
function cellOf(text: string, needle: string): { x: number; y: number } {
  const lines = text.split("\n")
  const y = lines.findIndex((line) => line.includes(needle))
  expect(y).toBeGreaterThan(-1)
  return { x: (lines[y] as string).indexOf(needle), y }
}

const providers = { kv: true, dialog: true, notifications: true }

test("right-clicking an inactive tab opens its menu, and Rename acts on that tab", async () => {
  const tabs: readonly TerminalTab[] = [
    { kind: "engine", id: "tab-1", title: "alpha-one", ordinal: 1 },
    { kind: "command", id: "tab-2", title: "beta-two", ordinal: 2, command: ["zsh"] },
  ]
  const renamed: string[] = []
  const { frame, mockMouse, mockInput } = await renderComponent(
    <Driver tabs={tabs} onRename={(id) => renamed.push(id)} />,
    { width: 80, height: 16, providers },
  )
  const at = cellOf(await frame(), "beta-two")
  await act(async () => mockMouse.click(at.x, at.y, RIGHT))
  const open = await waitForFrameText(frame, "Rename tab")
  expect(open).toContain("Copy tab address")
  expect(open).toContain("Close other tabs")
  expect(open).toContain("Close tab")

  await act(async () => mockInput.pressEnter())
  expect(renamed).toEqual(["tab-2"])
  expect(await frame()).not.toContain("Close other tabs")
})

test("an engine tab offers Continue in another engine and it acts on the clicked tab; a shell tab does not", async () => {
  const tabs: readonly TerminalTab[] = [
    { kind: "engine", id: "tab-1", title: "alpha-one", ordinal: 1 },
    { kind: "engine", id: "tab-2", title: "beta-two", ordinal: 2 },
    { kind: "command", id: "tab-3", title: "gamma-three", ordinal: 3, command: ["zsh"] },
  ]
  const continued: string[] = []
  const { frame, mockMouse, mockInput } = await renderComponent(
    <Driver tabs={tabs} onRename={() => {}} onContinue={(id) => continued.push(id)} />,
    { width: 80, height: 16, providers },
  )
  const shell = cellOf(await frame(), "gamma-three")
  await act(async () => mockMouse.click(shell.x, shell.y, RIGHT))
  expect(await waitForFrameText(frame, "Rename tab")).not.toContain("Continue in another engine")
  mockInput.pressEscape()
  // The lone ESC byte is held for opentui's escape-sequence window.
  await settle()

  const engine = cellOf(await frame(), "beta-two")
  await act(async () => mockMouse.click(engine.x, engine.y, RIGHT))
  await waitForFrameText(frame, "Continue in another engine")
  await act(async () => {
    mockInput.pressArrow("down")
    mockInput.pressEnter()
  })
  expect(continued).toEqual(["tab-2"])
})

test("a lone preview tab offers only rename and close; escape dismisses", async () => {
  const tabs: readonly TerminalTab[] = [
    { kind: "content", id: "tab-1", title: "notes.md", ordinal: 1, relPath: "notes.md" },
  ]
  const { frame, mockMouse, mockInput } = await renderComponent(<Driver tabs={tabs} onRename={() => {}} />, {
    width: 80,
    height: 16,
    providers,
  })
  const at = cellOf(await frame(), "notes.md")
  await act(async () => mockMouse.click(at.x, at.y, RIGHT))
  const open = await waitForFrameText(frame, "Rename tab")
  expect(open).toContain("Close tab")
  // Nothing runs in a preview for `rove api send --tab` to reach, and no sibling to close.
  expect(open).not.toContain("Copy tab address")
  expect(open).not.toContain("Close other tabs")

  mockInput.pressEscape()
  await settle()
  expect(await frame()).not.toContain("Rename tab")
})

test("on a narrow screen the one visible tab opens the same menu", async () => {
  const tabs: readonly TerminalTab[] = [
    { kind: "engine", id: "tab-1", title: "alpha-one", ordinal: 1 },
    { kind: "engine", id: "tab-2", title: "beta-two", ordinal: 2 },
  ]
  // Below the narrow breakpoint the strip shows only the active tab and a `1/2` counter.
  const { frame, mockMouse } = await renderComponent(<Driver tabs={tabs} onRename={() => {}} />, {
    width: 50,
    height: 16,
    providers,
  })
  const at = cellOf(await frame(), "alpha-one")
  await act(async () => mockMouse.click(at.x, at.y, RIGHT))
  expect(await waitForFrameText(frame, "Close other tabs")).toContain("Close other tabs")
})

type MenuInput = { pressKey: (key: string, modifiers?: { ctrl?: boolean }) => void }
type MenuControls = { select?: (id: string) => void; remove?: () => void }

/** How the menu goes stale under the user: the active tab moves, or the clicked tab goes away. */
const CHANGES = [
  ["keyboard", (input: MenuInput) => input.pressKey("]", { ctrl: true })],
  ["external selection", (_input: MenuInput, controls: MenuControls) => controls.select?.("tab-1")],
  ["disappearance", (_input: MenuInput, controls: MenuControls) => controls.remove?.()],
] as const
/** Cursor moves from the menu's first row onto the verb: rename, continue, copy, close others, close. */
const ACTIONS = [
  ["rename", 0],
  ["close", 4],
] as const

test.each(
  ACTIONS.flatMap(([action, moves]) => CHANGES.map(([change, mutate]) => [action, change, moves, mutate] as const)),
)("%s cannot act on a stale menu after %s", async (_action, _change, moves, mutate) => {
  const tabs: readonly TerminalTab[] = [
    { kind: "engine", id: "tab-1", title: "alpha-one", ordinal: 1 },
    { kind: "engine", id: "tab-2", title: "beta-two", ordinal: 2 },
  ]
  const actions: string[] = []
  const controls: MenuControls = {}
  const { frame, mockMouse, mockInput } = await renderComponent(
    <Driver
      tabs={tabs}
      controls={controls}
      onRename={(id) => actions.push(`rename:${id}`)}
      onClose={(id) => actions.push(`close:${id}`)}
    />,
    { width: 80, height: 16, providers },
  )
  const at = cellOf(await frame(), "beta-two")
  await act(async () => mockMouse.click(at.x, at.y, RIGHT))
  await waitForFrameText(frame, "Rename tab")
  Array.from({ length: moves }, () => act(() => mockInput.pressKey("j")))
  await act(async () => mutate(mockInput, controls))
  await act(async () => mockInput.pressEnter())
  expect(actions).toEqual([])
  expect(await frame()).not.toContain("Rename tab")
})
