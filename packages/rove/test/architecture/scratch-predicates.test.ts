/**
 * A task's `scratch` flag is read and cleared only through `task-scratch.ts`, so "throwaway" and
 * "Ungrouped" cannot drift apart again. The store codec and the wire serializers carry it as data.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const PACKAGES = fileURLToPath(new URL("../../..", import.meta.url))
const SCANNED = ["rove", "rove-core", "rove-client", "rove-daemon", "rove-bridge", "rove-web"]
const ALLOWED = new Set([
  "rove-daemon/src/task-scratch.ts",
  "rove-core/src/orchestrator/index/store-codec-rows.ts",
  "rove-daemon/src/daemon/serialize-task.ts",
  "rove-bridge/src/task-rows.ts",
  "rove-client/src/client/remote-orchestrator-payloads.ts",
])
// A property read (`x.scratch`; not the `.scratch/` directory or an i18n key) or a clearing write.
const DIRECT = /(?<!["'`/])\.scratch\b(?![/"'`])|\bscratch:\s*false\b/

function sources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sources(full, acc)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) acc.push(full)
  }
  return acc
}

describe("task.scratch goes through task-scratch.ts", () => {
  test("no other source file reads or clears it directly", () => {
    const offenders = SCANNED.flatMap((pkg) => sources(join(PACKAGES, pkg, "src")))
      .map((file) => relative(PACKAGES, file))
      .filter((file) => !ALLOWED.has(file) && DIRECT.test(readFileSync(join(PACKAGES, file), "utf8")))
    expect(offenders).toEqual([])
  })
})
