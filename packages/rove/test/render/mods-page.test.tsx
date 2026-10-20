/** @jsxImportSource @opentui/react */
/**
 * The TUI half of a mod: the element tree the daemon published draws as real
 * OpenTUI boxes, and Enter on the focused button sends that button's key back.
 */

import { expect, test } from "bun:test"
import type { ModPaneView } from "@sma1lboy/rove-daemon/plugins/mod-tree"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { createStateCell } from "../../src/lib/external-store"
import { ModsPage } from "../../src/tui-react/component/mods-page"
import { renderComponent } from "./harness"

process.env.ROVE_HOME_DIR ??= (await import("node:fs")).mkdtempSync("/tmp/rove-mods-page-")

const PANE: ModPaneView = {
  plugin: "examples.counter-mod",
  id: "main",
  title: "Counter",
  tree: {
    type: "box",
    direction: "column",
    children: [
      { type: "text", text: "Count: 3", bold: true },
      {
        type: "box",
        direction: "row",
        gap: 2,
        children: [
          { type: "button", key: "inc", label: "+1" },
          { type: "button", key: "dec", label: "-1" },
        ],
      },
    ],
  },
}

test("draws a mod's tree and presses the focused button on Enter", async () => {
  const presses: string[] = []
  const orchestrator = {
    modPanesSignal: () => createStateCell<readonly ModPaneView[]>([PANE]),
    pressMod: async (plugin: string, pane: string, key: string) => {
      presses.push(`${plugin}/${pane}/${key}`)
      return { ok: true }
    },
  } as unknown as RemoteOrchestrator
  const { frame, mockInput } = await renderComponent(
    <ModsPage orchestrator={orchestrator} focused onClose={() => {}} />,
    {
      width: 80,
      height: 20,
      providers: { dialog: true, kv: true, notifications: true },
    },
  )
  const text = await frame()
  expect(text).toContain("Counter · examples.counter-mod")
  expect(text).toContain("Count: 3")
  expect(text).toMatch(/\[ \+1 \] {2}\[ -1 \]/)

  mockInput.pressArrow("down")
  mockInput.pressEnter()
  await new Promise((r) => setTimeout(r, 50))
  expect(presses).toEqual(["examples.counter-mod/main/dec"])
})
