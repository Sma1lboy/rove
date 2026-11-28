/**
 * Web, bridge and chat connectors must not import the TUI.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const PACKAGES = fileURLToPath(new URL("../../..", import.meta.url))
const CLIENTS = ["rove-web/src", "rove-bridge/src", "rove-lark", "rove-weixin"]
const SKIP = new Set(["node_modules", "dist", "build"])
const TUI_SPEC = /(?:from|import\()\s*["'][^"']*rove\/src\/(tui(?:-react)?\/[^"'?]+)/g

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
  test("no client imports a src/tui* module", () => {
    expect([...importedTuiModules()].sort()).toEqual([])
  })
})
