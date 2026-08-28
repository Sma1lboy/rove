/** @jsxImportSource @opentui/react */

import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrefixHud } from "../../src/tui-react/component/prefix-hud"
import { ShortcutRevealProvider } from "../../src/tui-react/component/shortcut-reveal"
import { useBindings } from "../../src/tui-react/lib/keymap"
import { SidebarNavRail } from "../../src/tui-react/panes/sidebar/chrome"
import { bindByIds } from "../../src/tui/context/keybindings"
import { prefixAction } from "../../src/tui/lib/keymap-dispatch"
import { PREFIX_TAP_PRESENTATION_KEY } from "../../src/tui/lib/prefix-tap-presentation"
import { act, renderComponent, settle } from "./harness"

function locate(frame: string, text: string): { x: number; y: number } {
  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes(text))
  if (y < 0) throw new Error(`missing ${text}`)
  return { x: lines[y]?.indexOf(text) ?? -1, y }
}

function RevealFixture(props: { onOpenEditor?: () => void }) {
  useBindings(() => ({
    bindings: bindByIds({
      "kanban.open": prefixAction(() => {}),
      "automations.open": prefixAction(() => {}),
      "task.openEditor": prefixAction(() => props.onOpenEditor?.()),
    }),
  }))
  return (
    <>
      <SidebarNavRail nav="terminal" setNav={() => {}} />
      <PrefixHud left={1} width={22} />
    </>
  )
}

function tempHome(mode?: "local" | "guide"): string {
  const home = mkdtempSync(join(tmpdir(), "rove-prefix-tap-"))
  if (mode) {
    const configDir = join(home, ".config", "rove")
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, "state.json"), JSON.stringify({ [PREFIX_TAP_PRESENTATION_KEY]: mode }))
  }
  return home
}

async function waitForFrameText(frame: () => Promise<string>, text: string): Promise<string> {
  const deadline = Date.now() + 1_000
  let current = await frame()
  while (!current.includes(text) && Date.now() < deadline) {
    await settle(25)
    current = await frame()
  }
  return current
}

test("the default prefix tap shows local badges and the complete command guide together", async () => {
  process.env.KOBE_HOME_DIR = tempHome()
  const { mockInput, frame } = await renderComponent(
    <ShortcutRevealProvider>
      <RevealFixture />
    </ShortcutRevealProvider>,
    { width: 160, height: 30, providers: { kv: true } },
  )

  act(() => mockInput.pressKey("a", { ctrl: true }))
  const local = await waitForFrameText(frame, "more Rove commands")
  expect(local).toContain("⌃ A 1")
  expect(local).toContain("⌃ A 2")
  expect(local).toContain("more Rove commands")
  expect(local).toContain("Open active Task directory in editor")
  expect(local).not.toContain("Open active…")

  act(() => mockInput.pressKey("escape"))
  await settle()
  expect(await frame()).not.toContain("⌃ A 1")
})

test("a complete-guide row is a real clickable entry in local mode", async () => {
  process.env.KOBE_HOME_DIR = tempHome()
  let editorOpens = 0
  const { mockInput, mockMouse, frame } = await renderComponent(
    <ShortcutRevealProvider>
      <RevealFixture onOpenEditor={() => editorOpens++} />
    </ShortcutRevealProvider>,
    { width: 160, height: 30, providers: { kv: true } },
  )

  act(() => mockInput.pressKey("a", { ctrl: true }))
  const revealed = await waitForFrameText(frame, "Open active Task directory in editor")
  const at = locate(revealed, "Open active Task directory in editor")
  await mockMouse.click(at.x + 1, at.y)
  await settle()

  expect(editorOpens).toBe(1)
  expect(await frame()).not.toContain("more Rove commands")
})

test("the guide setting routes the same prefix tap to the global command guide", async () => {
  process.env.KOBE_HOME_DIR = tempHome("guide")
  const { mockInput, frame } = await renderComponent(
    <ShortcutRevealProvider>
      <RevealFixture />
    </ShortcutRevealProvider>,
    { width: 160, height: 30, providers: { kv: true } },
  )

  act(() => mockInput.pressKey("a", { ctrl: true }))
  const guide = await waitForFrameText(frame, "more Rove commands")
  expect(guide).toContain("more Rove commands")
  expect(guide).toContain("Open active Task directory in editor")
  expect(guide).not.toContain("⌃ A 1")
})
