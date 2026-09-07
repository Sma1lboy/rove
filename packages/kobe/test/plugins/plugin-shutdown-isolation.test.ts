/**
 * `PluginHost.stop()` is documented as resolving only once EVERY shutdown
 * hook has exited or been SIGKILLed, "or `process.exit` destroys the grace
 * timers and the hook children become unbounded orphans". That promise held
 * only while `runPluginHook` never rejected — which nothing enforced. Two
 * manifests reach `spawn` through a reject, and one bad plugin then returned
 * `stop()` early while every other plugin's hook was still running,
 * unawaited and unreaped.
 *
 * Both are driven through a REAL `PluginHost` against a real registry in an
 * isolated home — no stubbed hook runner, because the thing under test is
 * whether the host actually waits for a child process it spawned.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pluginConfigDir, pluginLogPath } from "@sma1lboy/kobe-daemon/plugins/plugin-paths"
import { type PluginRegistryEntry, savePluginRegistry } from "@sma1lboy/kobe-daemon/plugins/registry"
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

/** TOML's escape for a NUL byte. A manifest may write it, the parser accepts
 *  it, and the argv reaching `spawn` then holds a real NUL — which throws
 *  ERR_INVALID_ARG_VALUE synchronously, inside the hook's promise executor.
 *  Written as an escape here so this source file stays free of control bytes. */
const NUL_ESCAPE = "\\u0000"

function manifest(id: string, section: string, hook: string): string {
  return [`id = "${id}"`, `name = "${id}"`, 'version = "0.1.0"', 'min_rove_version = "0.1.0"', "", section, hook].join(
    "\n",
  )
}

/** A hook that appends a marker to a file the test can read, so "the hook ran
 *  to completion" is observed rather than assumed. */
function healthyShutdown(markerPath: string): string {
  return manifest("example.healthy", "[[shutdown]]", `command = ["sh", "-c", "echo done > '${markerPath}'"]`)
}

function install(home: string, plugins: readonly (readonly [string, string])[]): void {
  mkdirSync(join(home, ".rove"), { recursive: true })
  const entries: PluginRegistryEntry[] = []
  for (const [id, text] of plugins) {
    const root = tmp(`rove-shutdown-root-${id.replace(/\W/g, "-")}-`)
    writeFileSync(join(root, "rove-plugin.toml"), text)
    entries.push({ id, source: { kind: "link" }, root, enabled: true, version: "0.1.0", installedAt: 1 })
  }
  savePluginRegistry({ plugins: entries }, home)
}

function host(home: string, log?: (line: string) => void): PluginHost {
  return new PluginHost({
    homeDir: home,
    socketPath: join(home, "fake.sock"),
    binPath: "rove-test-bin",
    ...(log ? { log } : {}),
  })
}

function records(home: string, id: string): Record<string, unknown>[] {
  try {
    return readFileSync(pluginLogPath(id, home), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  } catch {
    return []
  }
}

async function waitFor(predicate: () => boolean, ms = 5_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe("one plugin's failure does not abandon another plugin's shutdown hook", () => {
  it("records a spawnError when the hook's config dir is occupied by a file", async () => {
    const home = tmp("rove-shutdown-dir-")
    const marker = join(tmp("rove-shutdown-marker-"), "healthy")
    install(home, [
      ["example.broken", manifest("example.broken", "[[shutdown]]", 'command = ["sh", "-c", "true"]')],
      ["example.healthy", healthyShutdown(marker)],
    ])
    // A FILE where the 0700 config dir has to go, so `mkdirSync` answers
    // EEXIST. Same shape as EACCES on an unwritable home or ENOSPC on a full
    // disk — the three reasons this call was ever going to fail in the field.
    mkdirSync(join(home, ".rove", "plugins", "example.broken"), { recursive: true })
    writeFileSync(pluginConfigDir("example.broken", home), "not a directory")

    const h = host(home)
    h.start()
    await h.stop()

    // The author's one diagnostic surface (`rove plugin log`) has to say what
    // happened, rather than go silent on the failure that took the host down.
    const broken = records(home, "example.broken")
    expect(broken.filter((r) => typeof r.spawnError === "string")).toHaveLength(1)
    expect(String(broken[0]?.spawnError)).toMatch(/EEXIST|ENOTDIR|EACCES|ENOSPC/)
    // ...and the healthy plugin's hook was still awaited to completion.
    expect(readFileSync(marker, "utf8").trim()).toBe("done")
    expect(records(home, "example.healthy").some((r) => r.exitCode === 0)).toBe(true)
  })

  it("survives a manifest whose argv cannot be spawned at all", async () => {
    const home = tmp("rove-shutdown-nul-")
    const marker = join(tmp("rove-shutdown-marker2-"), "healthy")
    install(home, [
      // Registered first, so a short-circuiting `Promise.all` abandons the
      // healthy hook while it is still in flight.
      ["example.broken", manifest("example.broken", "[[shutdown]]", `command = ["ec${NUL_ESCAPE}ho", "bye"]`)],
      ["example.healthy", healthyShutdown(marker)],
    ])

    const h = host(home)
    h.start()
    await expect(h.stop()).resolves.toBeUndefined()

    expect(readFileSync(marker, "utf8").trim()).toBe("done")
    expect(records(home, "example.healthy").some((r) => r.exitCode === 0)).toBe(true)
  })

  it("logs an unspawnable event hook instead of leaving an unhandled rejection", async () => {
    const home = tmp("rove-event-nul-")
    install(home, [
      [
        "example.broken",
        manifest("example.broken", "[[events]]", `on = "task.opened"\ncommand = ["ec${NUL_ESCAPE}ho"]`),
      ],
    ])
    const lines: string[] = []
    const h = host(home, (line) => lines.push(line))
    h.start()
    try {
      // Event hooks are fired with `void`, so a rejection escaping here is an
      // unhandledRejection in a daemon that runs for days.
      h.handleUiReport({ kind: "task.opened", taskId: "t1" })
      await waitFor(() => lines.some((l) => l.startsWith("plugin example.broken task.opened:")))
    } finally {
      await h.stop()
    }
    expect(lines.some((l) => l.includes("ERR_INVALID_ARG_VALUE"))).toBe(true)
  })
})
