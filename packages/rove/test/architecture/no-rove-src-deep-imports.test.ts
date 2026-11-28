/**
 * Clients reach Rove's code through its packages (`@sma1lboy/rove-core`,
 * `-client`, `-api`), never a deep `@sma1lboy/rove/src/…` path into the CLI
 * package. KNOWN only shrinks.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url))
const CLIENTS = ["rove-web", "rove-bridge", "rove-lark", "rove-weixin", "rove-harness", "branding"]
const DEEP = /["'`]@sma1lboy\/rove\/src\//

const KNOWN = new Set<string>([
  // The connector registry loads rove-weixin and rove-lark, which import core, so it can't live in core.
  "rove-bridge/src/ops/connectors.ts",
])

function sources(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") sources(full, acc)
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

function deepImporters(): string[] {
  return CLIENTS.flatMap((pkg) => ["src", "test"].flatMap((dir) => sources(join(PACKAGES, pkg, dir))))
    .filter((file) => DEEP.test(readFileSync(file, "utf8")))
    .map((file) => file.slice(PACKAGES.length))
}

test("no client imports @sma1lboy/rove/src/ outside KNOWN", () => {
  expect(deepImporters().filter((file) => !KNOWN.has(file))).toEqual([])
})

test("every KNOWN entry still deep-imports, so the list only shrinks", () => {
  const now = new Set(deepImporters())
  expect([...KNOWN].filter((file) => !now.has(file))).toEqual([])
})
