/** @jsxImportSource @opentui/react */
/**
 * An installed plugin's `[[pages]]` module, loaded from outside node_modules,
 * renders in the content pane on the host's OWN React: its hooks work (a second
 * React instance throws "Invalid hook call"), it binds keys through the host
 * keymap and reads strings it registered. A broken page loads as nothing,
 * with its reason kept for Settings → Plugins.
 */

import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { RemoteOrchestrator } from "../../src/client/remote-orchestrator"
import { loadPluginPages, pluginPageErrors } from "../../src/tui-react/pages/load-plugin-pages"
import { pageEntries, replacePageSources } from "../../src/tui-react/pages/registry"
import { type HostPageDeps, renderContentPage } from "../../src/tui-react/workspace/host-pages"
import { act, renderComponent, settle } from "./harness"

const MANIFEST = `id = "demo"
name = "Demo"
version = "0.1.0"
min_rove_version = "0.1.0"

[[pages]]
id = "counter"
title = "Counter"
entry = "page.tsx"
order = 40

[[pages]]
id = "broken"
title = "Broken"
entry = "broken.ts"
`

// Classic JSX: Bun resolves the automatic runtime's injected import outside
// any plugin hook, so a page outside node_modules cannot use it.
const PAGE = `/** @jsxRuntime classic */
/** @jsx h */
import { createElement as h, useState } from "react"

export default function page(host) {
  host.i18n.registerMessages("demo", { en: { greeting: "hello from a plugin" } })
  return function CounterPage(props) {
    const [count, setCount] = useState(0)
    const t = host.i18n.useT()
    host.keymap.useBindings(() => ({
      enabled: props.focused,
      bindings: [{ key: "x", cmd: () => setCount((n) => n + 1) }],
    }))
    return <text>{\`count \${count} · \${t("demo.greeting")}\`}</text>
  }
}
`

function installDemo(): string {
  const home = mkdtempSync(join(tmpdir(), "rove-plugin-pages-"))
  const root = join(home, "plugin")
  mkdirSync(root)
  writeFileSync(join(root, "rove-plugin.toml"), MANIFEST)
  writeFileSync(join(root, "page.tsx"), PAGE)
  writeFileSync(join(root, "broken.ts"), "export default 42\n")
  mkdirSync(join(home, ".rove"))
  writeFileSync(
    join(home, ".rove", "plugins.json"),
    JSON.stringify({
      plugins: [{ id: "demo", source: { kind: "link" }, root, enabled: true, version: "0.1.0", installedAt: 0 }],
    }),
  )
  return home
}

// The registry is process-wide and bun runs every render file in one process.
afterEach(() => replacePageSources("plugin:", new Map()))

function deps(nav: string): HostPageDeps {
  return {
    orchestrator: {} as RemoteOrchestrator,
    selectedTask: undefined,
    nav,
    pages: pageEntries(),
    worktreesOpen: false,
    updateOpen: false,
    closeWorktrees: () => {},
    closePage: () => {},
    closeUpdate: () => {},
    activateTask: () => {},
    contentFocused: true,
    engineStates: new Map(),
  }
}

test("a plugin page renders on the host's React, binds keys and reads its own strings", async () => {
  await loadPluginPages(installDemo())

  expect(
    pageEntries()
      .find((page) => page.id === "demo.counter")
      ?.title(),
  ).toBe("Counter")
  expect(pageEntries().some((page) => page.id === "demo.broken")).toBe(false)
  expect(pluginPageErrors()).toEqual([
    { pluginId: "demo", pageId: "broken", message: "default export must be a page factory: (host) => Page" },
  ])

  const { frame, mockInput } = await renderComponent(<box>{renderContentPage(deps("demo.counter"))}</box>, {
    width: 60,
    height: 6,
  })
  await settle()
  expect(await frame()).toContain("count 0 · hello from a plugin")
  await act(async () => {
    await mockInput.typeText("x")
  })
  await settle()
  expect(await frame()).toContain("count 1 · hello from a plugin")
})
