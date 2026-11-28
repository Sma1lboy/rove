/**
 * A workspace package reaches another only through its package name, never a
 * relative path (`../other-package/…`): the name keeps the boundary real and
 * survives a directory move. Files listed in KNOWN predate the rule; the list
 * only shrinks.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { expect, test } from "vitest"

const PACKAGES = fileURLToPath(new URL("../../../", import.meta.url))
const NAMES = readdirSync(PACKAGES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

const KNOWN = new Set<string>([
  "rove-daemon/src/client/daemon-process.ts",
  "rove-harness/test/server-session.test.ts",
  "rove-harness/test/web-page-selection.test.tsx",
  "rove-web/src/demo/transport.ts",
  "rove-web/src/wall/icons.ts",
  "rove/test/engine/chat-transcript-shape.test.ts",
  "rove/test/plugins/example-plugins.test.ts",
])

function sources(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sources(full, acc)
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

function crossers(): string[] {
  return NAMES.flatMap((own) => {
    const other = NAMES.filter((name) => name !== own).join("|")
    const crossing = new RegExp(`["'\`](?:\\.\\./)+(?:${other})/`)
    return ["src", "test"]
      .flatMap((dir) => sources(join(PACKAGES, own, dir)))
      .filter((file) => crossing.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(PACKAGES.length))
  })
}

test("no package reaches another workspace package by relative path", () => {
  expect(crossers().filter((file) => !KNOWN.has(file))).toEqual([])
})

test("every KNOWN entry still crosses, so the list only shrinks", () => {
  const now = new Set(crossers())
  expect([...KNOWN].filter((file) => !now.has(file))).toEqual([])
})
