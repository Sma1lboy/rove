import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readEngineVersion, withEngineVersions } from "@sma1lboy/rove-core/engine/engine-version.ts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rove-engine-version-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** An executable in the temp dir; `ran` records that it was invoked at all. */
function fakeCli(name: string, body: string): string {
  const file = join(dir, name)
  writeFileSync(file, `#!/bin/sh\ntouch "${join(dir, `${name}.ran`)}"\n${body}\n`)
  chmodSync(file, 0o755)
  return file
}

describe.skipIf(process.platform === "win32")("readEngineVersion", () => {
  it("reads the version the engine's own CLI prints", async () => {
    const bin = fakeCli("claude", 'echo "2.1.3 (Claude Code)"')
    expect(await readEngineVersion("claude", { found: true, path: bin })).toBe("2.1.3")
  })

  it("keeps a prerelease suffix", async () => {
    const bin = fakeCli("codex", 'echo "codex-cli 0.47.0-alpha.2"')
    expect(await readEngineVersion("codex", { found: true, path: bin })).toBe("0.47.0-alpha.2")
  })

  it("never calls a launch-command wrapper that is not the engine's own CLI", async () => {
    const bin = fakeCli("my-claude-wrapper", 'echo "9.9.9"')
    expect(await readEngineVersion("claude", { found: true, path: bin })).toBeNull()
    expect(existsSync(`${bin}.ran`)).toBe(false)
  })

  it("is null when the CLI fails or prints no version", async () => {
    expect(await readEngineVersion("claude", { found: true, path: fakeCli("claude", "echo 1.0.0; exit 2") })).toBeNull()
    expect(await readEngineVersion("codex", { found: true, path: fakeCli("codex", "echo hello") })).toBeNull()
  })

  it("does not ask an engine that declares no version flag", async () => {
    const bin = fakeCli("opencode", 'echo "0.6.3"')
    expect(await readEngineVersion("opencode", { found: true, path: bin })).toBeNull()
    expect(existsSync(`${bin}.ran`)).toBe(false)
  })
})

describe.skipIf(process.platform === "win32")("withEngineVersions", () => {
  it("adds a version only where one was read", async () => {
    const bin = fakeCli("claude", 'echo "2.1.3"')
    const statuses = await withEngineVersions([
      { vendor: "claude", binary: { found: true, path: bin }, account: null },
      { vendor: "codex", binary: { found: false, error: "not found on PATH" }, account: null },
    ])
    expect(statuses.map((s) => s.version)).toEqual(["2.1.3", undefined])
  })
})
