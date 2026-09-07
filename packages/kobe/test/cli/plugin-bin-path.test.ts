/**
 * `ROVE_BIN_PATH` must name THIS Rove, not whichever install sits first on
 * PATH — a machine with two installs used to have hooks calling the other one.
 */

import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { resolvePluginBinPath } from "../../src/cli/plugin-bin-path.ts"

const dir = mkdtempSync(join(tmpdir(), "rove-binpath-"))

function entry(name: string, mode: number): string {
  const path = join(dir, name)
  writeFileSync(path, "#!/usr/bin/env node\n")
  chmodSync(path, mode)
  return path
}

describe("resolvePluginBinPath", () => {
  it("uses the running entry point when it is a runnable file", () => {
    const packaged = entry("rove.js", 0o755)
    expect(resolvePluginBinPath(["node", packaged, "daemon", "start"])).toBe(packaged)
  })

  it("falls back to the invoked name when the entry needs a runtime in front", () => {
    // A dev checkout: `bun src/cli/rove.ts`, no exec bit, no single token.
    const source = entry("rove.ts", 0o644)
    expect(resolvePluginBinPath(["bun", source, "daemon", "start"])).toMatch(/^(rove|kobe)$/)
  })

  it("uses the executable itself when running from a compiled binary", () => {
    expect(resolvePluginBinPath(["/opt/rove", "daemon"], "file:///$bunfs/root/rove")).toBe(process.execPath)
  })
})
