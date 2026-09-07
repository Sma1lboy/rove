/**
 * What the host does with a hook that misbehaves, and what it watches to
 * notice an author's edit. Every case here was a measured production failure
 * against a real daemon before the fix, so each one asserts the observable a
 * plugin author would have checked and found empty.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pluginLogPath } from "@sma1lboy/kobe-daemon/plugins/plugin-paths"
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

async function waitFor(predicate: () => boolean, ms = 10_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 25))
  }
}

/** A registry with one linked, enabled plugin at `root`. */
function register(home: string, id: string, root: string): void {
  mkdirSync(join(home, ".kobe"), { recursive: true })
  savePluginRegistry(
    { plugins: [{ id, source: { kind: "link" }, root, enabled: true, version: "0.1.0", installedAt: 1 }] },
    home,
  )
}

function logRecords(id: string, home: string): Record<string, unknown>[] {
  try {
    return readFileSync(pluginLogPath(id, home), "utf8")
      .trimEnd()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
  } catch {
    return []
  }
}

function snapshotEvent(ids: string[]) {
  const tasks = ids.map((id) => ({
    id,
    title: id,
    repo: "/r",
    branch: "b",
    worktreePath: "/w",
    kind: "task",
    status: "active",
    pinned: false,
    createdAt: "x",
    updatedAt: "x",
  }))
  return { channel: "task.snapshot", payload: { tasks } } as never
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("hook deadline", () => {
  // The hook backgrounds a sleep and waits on it, so the shell does NOT exec:
  // signalling the child alone would leave the sleep behind, which is exactly
  // how four fires of a hanging hook left eight live processes.
  const HANGING = `
id = "example.hang"
name = "Hang"
version = "0.1.0"
min_rove_version = "0.1.0"

[[events]]
on = "task.created"
timeout_ms = 900
command = ["sh", "-c", "sleep 60 </dev/null & printf %s \\"$!\\" > grandchild.pid; wait"]
`

  it("kills a hanging hook and its whole process group, and logs it while it runs", async () => {
    const home = tmp("kobe-hang-home-")
    const root = tmp("kobe-hang-root-")
    writeFileSync(join(root, "rove-plugin.toml"), HANGING)
    register(home, "example.hang", root)

    const lines: string[] = []
    const host = new PluginHost({
      homeDir: home,
      socketPath: "/tmp/fake.sock",
      binPath: "kobe",
      log: (l) => lines.push(l),
    })
    host.start()
    try {
      host.handleChannel(snapshotEvent(["a"])) // baseline
      host.handleChannel(snapshotEvent(["a", "b"]))

      // The record an author checks. It used to arrive only on close, so a
      // hook that never closed produced "(no runs logged yet)" forever.
      await waitFor(() => logRecords("example.hang", home).some((r) => r.phase === "running"))

      const pid = Number(readFileSync(join(root, "grandchild.pid"), "utf8"))
      expect(alive(pid)).toBe(true)

      await waitFor(() => logRecords("example.hang", home).some((r) => r.timedOut === true))
      // SIGKILL went to the group, so the grandchild the shell left behind is
      // gone too — not merely the shell the host spawned.
      await waitFor(() => !alive(pid))
      expect(lines.some((l) => l.includes("killed after 900ms"))).toBe(true)
    } finally {
      await host.stop()
    }
  })

  it("stop() reaps a hook still running, instead of waiting out its deadline", async () => {
    const home = tmp("kobe-reap-home-")
    const root = tmp("kobe-reap-root-")
    writeFileSync(
      join(root, "rove-plugin.toml"),
      HANGING.replace("timeout_ms = 900", "timeout_ms = 120000").replace('id = "example.hang"', 'id = "example.reap"'),
    )
    register(home, "example.reap", root)

    const host = new PluginHost({ homeDir: home, socketPath: "/tmp/fake.sock", binPath: "kobe" })
    host.start()
    host.handleChannel(snapshotEvent(["a"]))
    host.handleChannel(snapshotEvent(["a", "b"]))
    await waitFor(() => {
      try {
        return readFileSync(join(root, "grandchild.pid"), "utf8").length > 0
      } catch {
        return false
      }
    })
    const pid = Number(readFileSync(join(root, "grandchild.pid"), "utf8"))

    // A two-minute deadline must not become a two-minute `rove daemon stop`:
    // the leaked children hold the daemon's stdout/stderr pipes, so a daemon
    // that leaves them running cannot exit at all.
    const startedAt = Date.now()
    await host.stop()
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    await waitFor(() => !alive(pid), 5_000)
  })
})

describe("what the host watches", () => {
  const BASE = `
id = "example.edit"
name = "Edit"
version = "0.1.0"
min_rove_version = "0.1.0"

[[events]]
on = "plugin.disabled"
command = ["sh", "-c", "printf teardown > teardown.txt"]
`

  const read = (root: string, name: string): string => {
    try {
      return readFileSync(join(root, name), "utf8")
    } catch {
      return ""
    }
  }

  it("applies a manifest edit without a second `plugin link`", async () => {
    const home = tmp("kobe-edit-home-")
    const root = tmp("kobe-edit-root-")
    writeFileSync(join(root, "rove-plugin.toml"), BASE)
    register(home, "example.edit", root)

    const host = new PluginHost({ homeDir: home, socketPath: "/tmp/fake.sock", binPath: "kobe" })
    host.start()
    try {
      // The documented dev loop is "edit the manifest, watch the hook fire".
      // Only the registry used to be watched, so this hook never fired and
      // `rove plugin log` stayed empty with no warning anywhere.
      writeFileSync(
        join(root, "rove-plugin.toml"),
        `${BASE}\n[[events]]\non = "task.created"\ncommand = ["sh", "-c", "printf hot > hot.txt"]\n`,
      )
      await new Promise((r) => setTimeout(r, 600)) // poll + debounce
      host.handleChannel(snapshotEvent(["a"]))
      host.handleChannel(snapshotEvent(["a", "b"]))
      await waitFor(() => read(root, "hot.txt") === "hot")
    } finally {
      await host.stop()
    }
  })

  it("does not fire plugin.disabled when the manifest merely stops parsing", async () => {
    const home = tmp("kobe-typo-home-")
    const root = tmp("kobe-typo-root-")
    writeFileSync(join(root, "rove-plugin.toml"), BASE)
    register(home, "example.edit", root)

    const lines: string[] = []
    const host = new PluginHost({
      homeDir: home,
      socketPath: "/tmp/fake.sock",
      binPath: "kobe",
      log: (l) => lines.push(l),
    })
    host.start()
    try {
      // A TOML typo is a health problem, not a lifecycle transition: teardown
      // must not run — a plugin that unregisters a webhook on plugin.disabled
      // would do it because the author fat-fingered a bracket.
      writeFileSync(join(root, "rove-plugin.toml"), `${BASE}\n[[events\n`)
      await waitFor(() => lines.some((l) => l.includes("manifest unreadable")))
      await new Promise((r) => setTimeout(r, 400))
      expect(read(root, "teardown.txt")).toBe("")
    } finally {
      await host.stop()
    }
  })
})
