/**
 * `pastePromptWhenEngineUp`'s repo-init wait: how it reads the per-worktree
 * init marker before it starts spending the engine-startup budget.
 *
 * Split out of hosted-session.test.ts — that file is about the paste itself
 * (does the prompt reach the composer, do the busy gates hold); these are
 * about one file on disk and what its contents mean, and they own the
 * temp-dir plumbing nothing else there needs.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { type HostedSessionRpc, pastePromptWhenEngineUp } from "../../src/engine/hosted-session.ts"

function session(key: string) {
  return { key, alive: true, pid: 42, command: ["engine"], title: "engine" }
}

describe("pastePromptWhenEngineUp repo-init marker wait", () => {
  const noSleep = () => Promise.resolve()
  // ps -A -o pid=,ppid=,args= shape: a shell (pid 42) with a kimi child.
  const withEngine = "  42   1 /bin/zsh -ilc kimi\n  43  42 kimi\n"

  it("waits for the init marker before budgeting engine-startup time", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-hosted-init-marker-"))
    const marker = path.join(tmp, "marker")
    let written = ""
    const request = vi.fn().mockImplementation((name: string, payload: unknown) => {
      // A ready engine (bracketed paste on) that echoes what it is written,
      // so the readiness wait and the capture confirmation both settle.
      if (name === "pty.peek")
        return Promise.resolve({
          exists: true,
          alive: true,
          offset: 0,
          data: Buffer.from(`\x1b[?2004h${written}`).toString("base64"),
        })
      if (name === "pty.write") {
        written += (payload as { data?: string })?.data ?? ""
        return Promise.resolve({})
      }
      return Promise.resolve({ sessions: [session("task-a::tab-1")] })
    })
    const rpc: HostedSessionRpc = { request }

    let engineChecked = false
    let markerChecked = false
    const sleep = vi.fn().mockImplementation(async () => {
      if (!markerChecked) {
        // The recorded exit code, which is what the launch script writes when
        // init finishes. An EMPTY marker is the pre-0.9.101 shape the shell
        // itself re-runs init on — see the sibling test below.
        fs.writeFileSync(marker, "0")
        markerChecked = true
      }
    })
    const snapshot = vi.fn().mockImplementation(async () => {
      engineChecked = true
      return withEngine
    })

    const delivered = await pastePromptWhenEngineUp(rpc, "task-a::tab-1", "kimi", "fix it", {
      initMarkerPath: marker,
      initTimeoutMs: 50,
      sleep,
      snapshot,
    })

    expect(delivered).not.toBeNull()
    expect(markerChecked).toBe(true)
    expect(engineChecked).toBe(true)
    expect(snapshot).toHaveBeenCalled()
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  // The marker records the init OUTCOME, so it appears on a failing init too.
  // While it only appeared on success, "init failed" and "init still running"
  // were the same observation from here and this loop sat out its whole
  // 120s budget before the prompt was ever pasted.
  it("stops waiting on the first poll after a FAILING init records its outcome", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-hosted-init-failed-"))
    const marker = path.join(tmp, "marker")
    let written = ""
    const request = vi.fn().mockImplementation((name: string, payload: unknown) => {
      if (name === "pty.peek")
        return Promise.resolve({
          exists: true,
          alive: true,
          offset: 0,
          data: Buffer.from(`\x1b[?2004h${written}`).toString("base64"),
        })
      if (name === "pty.write") {
        written += (payload as { data?: string })?.data ?? ""
        return Promise.resolve({})
      }
      return Promise.resolve({ sessions: [session("task-a::tab-1")] })
    })
    const rpc: HostedSessionRpc = { request }

    // Two marker-loop sleeps, then the launch script records `1` (init failed).
    let markerSleeps = 0
    let markerLanded = false
    const sleep = vi.fn().mockImplementation(async () => {
      if (markerLanded) return
      markerSleeps += 1
      if (markerSleeps === 2) {
        fs.writeFileSync(marker, "1")
        markerLanded = true
      }
    })

    const delivered = await pastePromptWhenEngineUp(rpc, "task-a::tab-1", "kimi", "fix it", {
      initMarkerPath: marker,
      // A budget far larger than the marker wait: if the loop ran to the
      // deadline instead of reacting to the sentinel, `markerSleeps` would
      // keep climbing.
      initTimeoutMs: 600_000,
      sleep,
      snapshot: async () => withEngine,
    })

    expect(delivered).not.toBeNull()
    expect(markerSleeps).toBe(2) // exited on the poll right after it appeared
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  // The stale-marker half of the same rule: an EMPTY marker is what
  // pre-0.9.101 launches left on success, and the launch shell re-runs init on
  // one — so it means "still running" here too. Ending the wait on it handed
  // the engine-startup budget to a shell that had not started an engine yet.
  it("keeps waiting through an EMPTY pre-0.9.101 marker until a code is recorded", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-hosted-init-empty-"))
    const marker = path.join(tmp, "marker")
    fs.writeFileSync(marker, "")
    let written = ""
    const request = vi.fn().mockImplementation((name: string, payload: unknown) => {
      if (name === "pty.peek")
        return Promise.resolve({
          exists: true,
          alive: true,
          offset: 0,
          data: Buffer.from(`\x1b[?2004h${written}`).toString("base64"),
        })
      if (name === "pty.write") {
        written += (payload as { data?: string })?.data ?? ""
        return Promise.resolve({})
      }
      return Promise.resolve({ sessions: [session("task-a::tab-1")] })
    })
    const rpc: HostedSessionRpc = { request }

    let markerSleeps = 0
    let markerLanded = false
    const sleep = vi.fn().mockImplementation(async () => {
      if (markerLanded) return
      markerSleeps += 1
      if (markerSleeps === 3) {
        fs.writeFileSync(marker, "0")
        markerLanded = true
      }
    })

    const delivered = await pastePromptWhenEngineUp(rpc, "task-a::tab-1", "kimi", "fix it", {
      initMarkerPath: marker,
      initTimeoutMs: 600_000,
      sleep,
      snapshot: async () => withEngine,
    })

    expect(delivered).not.toBeNull()
    // Zero would mean the empty marker ended the wait on the first look.
    expect(markerSleeps).toBe(3)
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it("returns false if the session dies while waiting for the init marker", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kobe-hosted-init-marker-"))
    const marker = path.join(tmp, "marker")
    const request = vi.fn().mockResolvedValue({ sessions: [{ ...session("task-a::tab-1"), alive: false }] })
    const rpc: HostedSessionRpc = { request }

    const delivered = await pastePromptWhenEngineUp(rpc, "task-a::tab-1", "kimi", "fix it", {
      initMarkerPath: marker,
      initTimeoutMs: 50,
      sleep: noSleep,
    })

    expect(delivered).toBeNull()
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})
