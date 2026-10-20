/** @jsxImportSource @opentui/react */
/** The rail offers Mods only while some mod has a pane open, and drops it when the last one closes. */

import { expect, test } from "bun:test"
import type { ModPaneView } from "@sma1lboy/rove-daemon/plugins/mod-tree"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { createStateCell } from "../../src/lib/external-store"
import { registerModsPage } from "../../src/tui-react/pages/mods-pages"
import { pageEntries } from "../../src/tui-react/pages/registry"

const PANE: ModPaneView = { plugin: "p", id: "main", title: "T", tree: { type: "text", text: "hi" } }

test("the Mods rail row follows whether any mod pane is open", () => {
  const panes = createStateCell<readonly ModPaneView[]>([])
  const stop = registerModsPage({ modPanesSignal: () => panes } as unknown as RemoteOrchestrator)
  const hasMods = () => pageEntries().some((entry) => entry.id === "mods")
  expect(hasMods()).toBe(false)
  panes.set([PANE])
  expect(hasMods()).toBe(true)
  panes.set([])
  expect(hasMods()).toBe(false)
  stop()
})
