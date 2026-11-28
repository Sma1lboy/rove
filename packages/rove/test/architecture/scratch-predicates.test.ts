/**
 * `scratch` is a legacy stored/wire spelling of `noProject`: only the store codec and the client's
 * wire decode read it (mapping it onto `noProject`), and nothing writes it.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const PACKAGES = fileURLToPath(new URL("../../..", import.meta.url))
const SCANNED = ["rove", "rove-core", "rove-client", "rove-daemon", "rove-bridge", "rove-web", "rove-api"]
const ALLOWED = new Set([
  "rove-core/src/orchestrator/index/store-codec-rows.ts",
  "rove-client/src/client/remote-orchestrator-payloads.ts",
])
// A property read (`x.scratch`; not the `.scratch/` directory or an i18n key) or a write.
const DIRECT = /(?<!["'`/])\.scratch\b(?![/"'`])|\bscratch:\s*(true|false)\b/

function sources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sources(full, acc)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) acc.push(full)
  }
  return acc
}

describe("task.scratch is read only as a legacy alias", () => {
  test("no other source file reads or writes it", () => {
    const offenders = SCANNED.flatMap((pkg) => sources(join(PACKAGES, pkg, "src")))
      .map((file) => relative(PACKAGES, file))
      .filter((file) => !ALLOWED.has(file) && DIRECT.test(readFileSync(join(PACKAGES, file), "utf8")))
    expect(offenders).toEqual([])
  })
})
