/**
 * Web, bridge and chat connectors must not import the TUI. Shrink-only:
 * entries leave KNOWN as their modules move to core, and none may be added.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const PACKAGES = fileURLToPath(new URL("../../..", import.meta.url))
const CLIENTS = ["rove-web/src", "rove-bridge/src", "rove-lark", "rove-weixin"]
const SKIP = new Set(["node_modules", "dist", "build"])
const TUI_SPEC = /(?:from|import\()\s*["'][^"']*rove\/src\/(tui(?:-react)?\/[^"'?]+)/g

const KNOWN = new Set<string>([
  "tui-react/component/issue-events-core.ts",
  "tui-react/component/settings-dialog/plugins-core.ts",
  "tui-react/component/settings-dialog/usage-core.ts",
  "tui-react/lib/narrow-mode.ts",
  "tui-react/workspace/terminal-tabs-persist.ts",
  "tui/asset/pulse.wav",
  "tui/component/automation-composer-core.ts",
  "tui/component/automation-engine-core.ts",
  "tui/component/automation-run-core.ts",
  "tui/component/cron-core.ts",
  "tui/component/new-task-dialog/clone.ts",
  "tui/component/settings-dialog/appearance.ts",
  "tui/component/settings-dialog/model.ts",
  "tui/context/theme-core.ts",
  "tui/lib/git-snapshot-async.ts",
  "tui/lib/git-snapshot.ts",
  "tui/lib/glyphs.ts",
  "tui/lib/notify-state.ts",
  "tui/lib/task-color.ts",
  "tui/lib/worktree-opener.ts",
  "tui/ops/diff-comments.ts",
  "tui/ops/pr-prompt.ts",
  "tui/panes/filetree/open-external.ts",
  "tui/panes/mods/mods-core.ts",
  "tui/panes/sidebar/row-chips.ts",
  "tui/panes/sidebar/tree-labels.ts",
])

function sources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) sources(full, acc)
    } else if (/\.(tsx?|mjs)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

function importedTuiModules(): Set<string> {
  const found = new Set<string>()
  for (const client of CLIENTS)
    for (const file of sources(join(PACKAGES, client)))
      for (const [, path = ""] of readFileSync(file, "utf8").matchAll(TUI_SPEC)) found.add(path)
  return found
}

describe("clients do not import the TUI", () => {
  const imported = importedTuiModules()

  test("no client imports a src/tui* module outside the shrink-only list", () => {
    expect([...imported].filter((path) => !KNOWN.has(path)).sort()).toEqual([])
  })

  test("every list entry is still imported", () => {
    expect([...KNOWN].filter((path) => !imported.has(path)).sort()).toEqual([])
  })
})
