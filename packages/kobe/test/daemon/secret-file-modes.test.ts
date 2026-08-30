/**
 * Every store that persists what an agent printed, or what a user typed as a
 * credential, must land owner-only on disk. The freeze store is the sharp one:
 * `ringB64` is the session's entire scrollback, so a world-readable record is a
 * full transcript of `env` output, `cat`ed key files, and PAT-bearing remotes
 * for any local user to read.
 *
 * These assert the REAL mode via `statSync`, not the arguments a write was
 * called with — a wrapper that drops the option, or an umask interaction, has
 * to fail here.
 */

import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentTurnsStore } from "@sma1lboy/kobe-daemon/daemon/agent-turns-store"
import { fileFreezeSink, freezeSession } from "@sma1lboy/kobe-daemon/daemon/pty-freeze-store"
import { recordPtyExit } from "@sma1lboy/kobe-daemon/daemon/pty-exit-store"
import { pluginConfigDir } from "@sma1lboy/kobe-daemon/plugins/plugin-paths"
import { writePluginSettings } from "@sma1lboy/kobe-daemon/plugins/settings-env"
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

describe("stores that hold agent output or credentials are owner-only", () => {
  it("freezes a PTY session ring into a 0600 file inside a 0700 dir", () => {
    const dir = join(tmp("kobe-modes-freeze-"), "pty-sessions")
    fileFreezeSink(dir).save(
      freezeSession({
        key: "t::tab-1",
        cwd: "/tmp",
        command: ["bash"],
        cols: 80,
        rows: 24,
        title: "t",
        totalBytes: 5,
        exit: null,
        // The thing we are protecting: scrollback the agent produced.
        chunks: [Buffer.from("AWS_SECRET_ACCESS_KEY=wJalr")],
      }),
    )
    expect(mode(join(dir, "t%3A%3Atab-1.json"))).toBe(0o600)
    expect(mode(dir)).toBe(0o700)
  })

  it("writes pty-exits.json (which carries the dying process's last output) as 0600", () => {
    const path = join(tmp("kobe-modes-exits-"), "pty-exits.json")
    recordPtyExit(
      {
        key: "t::tab-1",
        pid: 4242,
        exit: { code: 1, signal: null, at: "2026-08-11T00:00:00.000Z" },
        tail: "GITHUB_TOKEN=ghp_x\nexiting",
      },
      path,
    )
    expect(mode(path)).toBe(0o600)
  })

  it("writes a plugin's settings .env as 0600 inside a 0700 config dir", () => {
    const home = tmp("kobe-modes-plugin-")
    writePluginSettings("p", { API_KEY: "sk-live-123" }, home)
    expect(mode(join(pluginConfigDir("p", home), ".env"))).toBe(0o600)
    expect(mode(pluginConfigDir("p", home))).toBe(0o700)
  })

  it("writes agent-turns.json as 0600", async () => {
    const path = join(tmp("kobe-modes-turns-"), "agent-turns.json")
    const store = new AgentTurnsStore(path)
    await store.record([{ id: "turn-1", taskId: "task-1", startedAt: 1, endedAt: 2 }])
    expect(mode(path)).toBe(0o600)
  })
})
