/** @jsxImportSource @opentui/react */
/**
 * Kanban and Issues ship as built-in plugins. Turning one off in Settings →
 * Plugins must take its rail row AND its page-open chord with it; the rest of
 * the rail keeps its order.
 */

import { afterEach, expect, test } from "bun:test"
import { registerBundledPlugins } from "../../src/tui-react/pages/bundled-pages"
import { pageEntries } from "../../src/tui-react/pages/registry"
import { SidebarNavRail } from "../../src/tui-react/panes/sidebar/chrome"
import { renderComponent, settle } from "./harness"

afterEach(() => registerBundledPlugins(() => true))

test("a built-in plugin turned off leaves the rail and frees its chord", async () => {
  registerBundledPlugins((id) => id !== "kanban")

  expect(pageEntries().map((page) => [page.id, page.action ?? null])).toEqual([
    ["automations", "automations.open"],
    ["issues.github", "workItems.open"],
  ])
  const { frame } = await renderComponent(<SidebarNavRail nav="terminal" setNav={() => {}} />, { width: 24, height: 6 })
  await settle()
  const text = await frame()
  expect(text).not.toContain("Kanban")
  expect(text.indexOf("Routines")).toBeLessThan(text.indexOf("Issues"))
})
