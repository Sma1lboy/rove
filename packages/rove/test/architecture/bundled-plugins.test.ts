/**
 * A built-in plugin (`src/bundled-plugins/<id>/`) is held to an installed
 * plugin's contract: at runtime it reaches Rove only through the page host its
 * factory receives. Type imports are erased, so they may name anything.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const ROOT = fileURLToPath(new URL("../../src/bundled-plugins", import.meta.url))
/** The runtime OpenTUI's plugin support maps onto the host's own copies. */
const SHARED = new Set(["react", "@opentui/core", "@opentui/react"])
const IMPORT = /^\s*import\s+(type\s+)?(\{[^}]*\}|[\w*\s,{}]+?)\s+from\s+["']([^"']+)["']/gm

function pluginDirs(): string[] {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(ROOT, entry.name))
}

function runtimeImports(source: string): string[] {
  const specs: string[] = []
  for (const match of source.matchAll(IMPORT)) {
    const [, allTypes, clause = "", spec = ""] = match
    if (allTypes) continue
    // `import { type A, type B } from …` is erased too.
    const names = clause
      .replace(/[{}]/g, "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
    if (clause.startsWith("{") && names.every((name) => name.startsWith("type "))) continue
    specs.push(spec)
  }
  return specs
}

describe("built-in plugins import Rove only through the page host", () => {
  test("every plugin directory exists and holds a plugin", () => {
    expect(
      pluginDirs()
        .map((dir) => relative(ROOT, dir))
        .sort(),
    ).toEqual(["issues", "kanban"])
  })

  test("runtime imports are the shared runtime or the plugin's own files", () => {
    const offenders: string[] = []
    for (const dir of pluginDirs()) {
      for (const file of readdirSync(dir).filter((name) => /\.tsx?$/.test(name))) {
        const path = join(dir, file)
        for (const spec of runtimeImports(readFileSync(path, "utf8"))) {
          const own = spec.startsWith(".") && resolve(dir, spec).startsWith(`${dir}/`)
          if (!SHARED.has(spec) && !own) offenders.push(`${relative(ROOT, path)} → ${spec}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
