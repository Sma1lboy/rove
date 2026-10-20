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
      { type: "input", key: "note", placeholder: "Add a note" },
    ],
  },
}

const PANES = createStateCell<readonly ModPaneView[]>([PANE])

async function renderPage() {
  const sent: string[] = []
  let closed = false
  const orchestrator = {
    modPanesSignal: () => PANES,
    pressMod: async (plugin: string, pane: string, key: string) => {
      sent.push(`press ${plugin}/${pane}/${key}`)
      return { ok: true }
    },
    submitMod: async (plugin: string, pane: string, key: string, value: string) => {
      sent.push(`submit ${plugin}/${pane}/${key}=${value}`)
      return { ok: true }
    },
  } as unknown as RemoteOrchestrator
  const rendered = await renderComponent(
    <ModsPage
      orchestrator={orchestrator}
      focused
      onClose={() => {
        closed = true
      }}
    />,
    {
      width: 80,
      height: 20,
      providers: { dialog: true, kv: true, notifications: true },
    },
  )
  return { ...rendered, sent, closed: () => closed }
}

test("draws a mod's tree and presses the focused button on Enter", async () => {
  const { frame, mockInput, sent } = await renderPage()
  const text = await frame()
  expect(text).toContain("Counter · examples.counter-mod")
  expect(text).toContain("Count: 3")
  expect(text).toMatch(/\[ \+1 \] {2}\[ -1 \]/)

  mockInput.pressArrow("down")
  mockInput.pressEnter()
  await new Promise((r) => setTimeout(r, 50))
  expect(sent).toEqual(["press examples.counter-mod/main/dec"])
})

test("typing in a mod field stays in the field, and Enter submits it to the mod", async () => {
  const { frame, mockInput, sent, closed } = await renderPage()
  expect(await frame()).toContain("Add a note")
  mockInput.pressArrow("down")
  mockInput.pressArrow("down")
  // `q` closes the page everywhere else on it; in a field it is a letter.
  await mockInput.typeText("quit early")
  mockInput.pressEnter()
  await new Promise((r) => setTimeout(r, 50))
  expect(closed()).toBe(false)
  expect(sent).toEqual(["submit examples.counter-mod/main/note=quit early"])
  // Submitted: the field empties, as the web's does.
  expect(await frame()).not.toContain("quit early")
})
