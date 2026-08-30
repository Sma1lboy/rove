/**
 * Everything the plugin subsystem persists is either a credential the docs
 * told the user to paste there, or output a plugin printed — and the plugin
 * log is both, because `run()` captures the child's stdout AND stderr into
 * the record. A plugin that prints its own token on failure writes it to a
 * file `rove plugin log` then displays; world-readable is the wrong default
 * for all of it.
 *
 * Modes are asserted with `statSync` on the REAL file, not the arguments a
 * write was called with — a dropped option or umask interaction has to fail
 * here. Same shape as `test/daemon/secret-file-modes.test.ts`.
 */

import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  pluginConfigDir,
  pluginLogPath,
  pluginRegistryPath,
  pluginStateDir,
} from "@sma1lboy/kobe-daemon/plugins/plugin-paths"
import { savePluginRegistry } from "@sma1lboy/kobe-daemon/plugins/registry"
import { PluginHost } from "@sma1lboy/kobe-daemon/plugins/runtime"
import { afterEach, describe, expect, it } from "vitest"

const dirs: string[] = []
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Permission bits only — `statSync().mode` carries the file type too. */
function mode(path: string): number {
  return statSync(path).mode & 0o777
}

async function waitFor(predicate: () => boolean, ms = 5_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 25))
  }
}

/** A plugin whose startup hook prints a secret — the realistic leak: the
 *  plugin is not malicious, it just logs what it got when something fails. */
const LEAKY = `
id = "example.leaky"
name = "Leaky"
version = "0.1.0"
min_rove_version = "0.1.0"

[[startup]]
command = ["sh", "-c", "echo sk-live-abc123 >&2; exit 1"]
`

function installPlugin(home: string, root: string, manifest: string, id: string): void {
  writeFileSync(join(root, "rove-plugin.toml"), manifest)
  mkdirSync(join(home, ".kobe"), { recursive: true })
  savePluginRegistry(
    { plugins: [{ id, source: { kind: "link" }, root, enabled: true, version: "0.1.0", installedAt: 1 }] },
    home,
  )
}

describe("plugin subsystem files are owner-only", () => {
  it("writes plugins.json as 0600", () => {
    const home = tmp("kobe-pmode-reg-")
    mkdirSync(join(home, ".kobe"), { recursive: true })
    savePluginRegistry({ plugins: [] }, home)
    expect(mode(pluginRegistryPath(home))).toBe(0o600)
  })

  it("writes the captured-output log as 0600 in 0700 config/state dirs", async () => {
    const home = tmp("kobe-pmode-log-")
    const root = tmp("kobe-pmode-root-")
    installPlugin(home, root, LEAKY, "example.leaky")
    const host = new PluginHost({ homeDir: home, socketPath: "/tmp/fake.sock", binPath: "kobe-test-bin" })
    const logPath = pluginLogPath("example.leaky", home)
    host.start()
    try {
      await waitFor(() => {
        try {
          return readFileSync(logPath, "utf8").includes("sk-live-abc123")
        } catch {
          return false
        }
      })
      // The secret really is in there — that is why the mode matters.
      expect(readFileSync(logPath, "utf8")).toContain("sk-live-abc123")
      expect(mode(logPath)).toBe(0o600)
      expect(mode(pluginConfigDir("example.leaky", home))).toBe(0o700)
      expect(mode(pluginStateDir("example.leaky", home))).toBe(0o700)
    } finally {
      await host.stop()
    }
  })
})

describe("the plugin log is size-capped", () => {
  it("rotates an oversized log to .old instead of growing forever", async () => {
    const home = tmp("kobe-pmode-rot-")
    const root = tmp("kobe-pmode-rot-root-")
    installPlugin(home, root, LEAKY, "example.leaky")
    const logPath = pluginLogPath("example.leaky", home)
    mkdirSync(pluginConfigDir("example.leaky", home), { recursive: true })
    // Past the 4MB cap: what a `tool.pre`/`tool.post` subscriber accumulates
    // over enough sessions when nothing ever truncates.
    appendFileSync(logPath, `${"x".repeat(5 * 1024 * 1024)}\n`)

    const host = new PluginHost({ homeDir: home, socketPath: "/tmp/fake.sock", binPath: "kobe-test-bin" })
    host.start()
    try {
      await waitFor(() => {
        try {
          return statSync(logPath).size < 1024 * 1024
        } catch {
          return false
        }
      })
      // Fresh file holding only the new record; one generation preserved.
      expect(statSync(logPath).size).toBeLessThan(1024 * 1024)
      expect(readFileSync(logPath, "utf8")).toContain('"kind":"startup"')
      expect(statSync(`${logPath}.old`).size).toBeGreaterThan(4 * 1024 * 1024)
    } finally {
      await host.stop()
    }
  })
})
