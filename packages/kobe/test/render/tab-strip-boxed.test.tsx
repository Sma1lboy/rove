/** @jsxImportSource @opentui/react */
/**
 * Boxed tab strip (2026-08-29 design): every tab is a closed rounded box;
 * the ACTIVE tab omits its bottom edge so the frame reads as a notch opening
 * into the pane below (claude-squad's `activeTabBorder`). Tabs sit flush —
 * the frames are the gutter — and the one-row viewport scrolls per cell to
 * keep the active tab fully visible, so the drawn width (2 cells of frame +
 * 2 of padding) and the scroll math's width must agree.
 *
 * The scroll half of that contract is driven by REAL keypresses: a sibling
 * binding cycles the active tab and the assertion is on which titles the
 * clipped frame still shows — an undercounted width would leave the active
 * tab's title clipped.
 */

import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useState } from "react"
import type { ChatTabTurnState } from "../../src/engine/turn-detector"
import { useBindings } from "../../src/tui-react/lib/keymap"
import { TabStrip } from "../../src/tui-react/workspace/tab-strip"
import type { TerminalTab } from "../../src/tui/workspace/terminal-tabs-core"
import { renderComponent } from "./harness"

process.env.KOBE_HOME_DIR ??= mkdtempSync(join(tmpdir(), "kobe-tab-strip-boxed-"))

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1

/** Cycle driver: `tab` advances the active id, like the workspace binding. */
function StripDriver(props: { tabs: readonly TerminalTab[]; start: string; width: number }) {
  const [activeId, setActiveId] = useState(props.start)
  const ids = props.tabs.map((tab) => tab.id)
  useBindings(() => ({
    enabled: true,
    bindings: [
      {
        key: "tab",
        cmd: () => setActiveId((cur) => ids[(ids.indexOf(cur) + 1) % ids.length] as string),
      },
    ],
  }))
  return (
    <TabStrip
      tabs={props.tabs}
      activeId={activeId}
      turnStates={new Map<string, ChatTabTurnState>()}
      onSelect={setActiveId}
      vendor="claude"
      liveTitles={new Map()}
      turnVendors={new Map()}
    />
  )
}

test("every tab is a closed box; only the active tab's bottom edge is missing", async () => {
  const tabs: readonly TerminalTab[] = [
    { kind: "engine", id: "tab-1", title: "one", ordinal: 1 },
    { kind: "engine", id: "tab-2", title: "two", ordinal: 2 },
    { kind: "engine", id: "tab-3", title: "three", ordinal: 3 },
  ]
  const { frame } = await renderComponent(<StripDriver tabs={tabs} start="tab-2" width={100} />, {
    width: 100,
    height: 4,
    providers: { kv: true },
  })
  const out = await frame()
  // Three boxes across the top…
  expect(count(out, "╭")).toBe(3)
  expect(count(out, "╮")).toBe(3)
  // …but only two bottoms: the active tab (tab-2) is the notch.
  expect(count(out, "╰")).toBe(2)
  expect(count(out, "╯")).toBe(2)
})

test("the scroll window follows key-driven tab switches and keeps the active tab whole", async () => {
  const tabs: readonly TerminalTab[] = Array.from({ length: 8 }, (_, i) => ({
    kind: "engine" as const,
    id: `tab-${i + 1}`,
    title: `workspace-${i + 1}`,
    ordinal: i + 1,
  }))
  const { frame, mockInput } = await renderComponent(<StripDriver tabs={tabs} start="tab-1" width={60} />, {
    width: 60,
    height: 4,
    providers: { kv: true },
  })
  // 8 boxes × 14 cells (frame 2 + padding 2 + "workspace-N" 10) = 112 cells
  // against a 59-cell viewport — the row must scroll.
  expect(await frame()).toContain("workspace-1")
  for (let i = 0; i < 7; i++) {
    mockInput.pressTab()
    await frame()
  }
  const atEnd = await frame()
  expect(atEnd).toContain("workspace-8")
  expect(atEnd).not.toContain("workspace-1")
  // Wrap back to the first tab: the window returns with it.
  mockInput.pressTab()
  expect(await frame()).toContain("workspace-1")
})
