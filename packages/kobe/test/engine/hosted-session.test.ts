import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  type HostedSessionRpc,
  deliverToHostedKey,
  ensureHostedEngine,
  hostedTaskKeys,
  isHostedTaskKey,
  killHostedSessions,
  listHostedSessions,
  pastePromptWhenEngineUp,
} from "../../src/engine/hosted-session.ts"

function session(key: string) {
  return { key, alive: true, pid: 42, command: ["engine"], title: "engine" }
}

describe("hosted session helpers", () => {
  it("lists sessions and degrades an unreachable host to an empty inventory", async () => {
    const sessions = [session("task-a::tab-1")]
    const request = vi.fn().mockResolvedValueOnce({ sessions }).mockRejectedValueOnce(new Error("offline"))
    const rpc: HostedSessionRpc = { request }

    await expect(listHostedSessions(rpc)).resolves.toEqual(sessions)
    await expect(listHostedSessions(rpc)).resolves.toEqual([])
    expect(request).toHaveBeenNthCalledWith(1, "pty.list", {})
  })

  it("matches only exact task-id prefixes and selects every task session key", () => {
    const sessions = [session("task-a::tab-1"), session("task-a::shell-2"), session("task-ab::tab-1")]

    expect(isHostedTaskKey("task-a::tab-1", "task-a")).toBe(true)
    expect(isHostedTaskKey("task-ab::tab-1", "task-a")).toBe(false)
    expect(isHostedTaskKey("task-a", "task-a")).toBe(true)
    expect(hostedTaskKeys(sessions, "task-a")).toEqual(["task-a::tab-1", "task-a::shell-2"])
  })

  it("attempts every kill even when one hosted session has already disappeared", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("already gone")).mockResolvedValueOnce({})
    const rpc: HostedSessionRpc = { request }

    await expect(killHostedSessions(rpc, ["task-a::tab-1", "task-a::shell-2"])).resolves.toBeUndefined()
    expect(request.mock.calls).toEqual([
      ["pty.kill", { key: "task-a::tab-1" }],
      ["pty.kill", { key: "task-a::shell-2" }],
    ])
  })

  it("opens the canonical engine PTY, detaches the short-lived client, and returns the host result", async () => {
    const opened = { replay: "", alive: true, pid: 42, created: true }
    const request = vi.fn().mockResolvedValueOnce(opened).mockRejectedValueOnce(new Error("detached concurrently"))
    const rpc: HostedSessionRpc = { request }
    const launch = {
      key: "task-a::tab-1",
      command: ["engine", "--resume", "session-1"],
      env: {},
    }

    const defaultColors = { foreground: "#eae7df", background: "#141413" } as const
    await expect(ensureHostedEngine(rpc, "/worktree", launch, defaultColors)).resolves.toEqual(opened)
    expect(request.mock.calls).toEqual([
      [
        "pty.open",
        {
          key: "task-a::tab-1",
          cwd: "/worktree",
          // No cols/rows: a size-less open must never resize a live
          // session away from its attached TUI.
          command: ["engine", "--resume", "session-1"],
          defaultColors,
        },
      ],
      ["pty.detach", { key: "task-a::tab-1" }],
    ])
  })
})

describe("pastePromptWhenEngineUp (first-message paste delivery)", () => {
  const noSleep = () => Promise.resolve()
  // ps -A -o pid=,ppid=,args= shape: a shell (pid 42) with a kimi child.
  const withEngine = "  42   1 /bin/zsh -ilc kimi\n  43  42 kimi\n"
  const shellOnly = "  42   1 /bin/zsh -ilc kimi\n"

  it("waits for the engine process, then bracketed-pastes and submits the prompt", async () => {
    const writes: unknown[] = []
    let written = ""
    const request = vi.fn().mockImplementation((name: string, payload: unknown) => {
      if (name === "pty.list") return Promise.resolve({ sessions: [session("task-a::tab-1")] })
      // A READY engine: bracketed paste announced (raw mode, reading) and
      // the prompt echoed back, so both the readiness wait and the capture
      // confirmation settle immediately.
      if (name === "pty.peek")
        return Promise.resolve({
          exists: true,
          alive: true,
          offset: 0,
          data: Buffer.from(`\x1b[?2004h${written}`).toString("base64"),
        })
      if (name === "pty.write") {
        written += (payload as { data?: string })?.data ?? ""
        writes.push(payload)
        return Promise.resolve({})
      }
      return Promise.reject(new Error(`unexpected ${name}`))
    })
    const rpc: HostedSessionRpc = { request }

    const delivered = await pastePromptWhenEngineUp(rpc, "task-a::tab-1", "kimi", "fix it", {
      snapshot: async () => withEngine,
      sleep: noSleep,
    })

    expect(delivered).not.toBeNull()
    expect(writes).toEqual([
      { key: "task-a::tab-1", data: "\x1b[200~fix it\x1b[201~" },
      { key: "task-a::tab-1", data: "\r" },
    ])
  })

  it("returns false without pasting when the session dies before any engine appears", async () => {
    const request = vi.fn().mockResolvedValue({ sessions: [{ ...session("task-a::tab-1"), alive: false }] })
    const rpc: HostedSessionRpc = { request }

    const delivered = await pastePromptWhenEngineUp(rpc, "task-a::tab-1", "kimi", "fix it", {
      snapshot: async () => withEngine,
      sleep: noSleep,
    })

    expect(delivered).toBeNull()
    expect(request).not.toHaveBeenCalledWith("pty.write", expect.anything())
  })

  it("gives up within the wait budget when only a bare shell ever shows", async () => {
    const request = vi.fn().mockResolvedValue({ sessions: [session("task-a::tab-1")] })
    const rpc: HostedSessionRpc = { request }

    const delivered = await pastePromptWhenEngineUp(rpc, "task-a::tab-1", "kimi", "fix it", {
      timeoutMs: 5,
      snapshot: async () => shellOnly,
      sleep: noSleep,
    })

    expect(delivered).toBeNull()
    expect(request).not.toHaveBeenCalledWith("pty.write", expect.anything())
  })
})

describe("deliverToHostedKey", () => {
  /** A pty that is reading (DECSET 2004) and echoes back whatever it is sent,
   *  so both readiness and the echo confirmation settle on the first poll.
   *  `screen` is whatever the composer already shows. */
  function echoingRpc(screen: string, opts?: { lastHumanWriteMs?: number }) {
    const writes: string[] = []
    let written = ""
    const rpc: HostedSessionRpc = {
      request: async <T>(name: string, payload?: unknown): Promise<T> => {
        if (name === "pty.peek") {
          return {
            exists: true,
            alive: true,
            pid: 42,
            offset: 0,
            data: Buffer.from(`\x1b[?2004h${screen}${written}`, "utf8").toString("base64"),
            sinceValid: false,
            exit: null,
            ...(opts?.lastHumanWriteMs === undefined ? {} : { lastHumanWriteMs: opts.lastHumanWriteMs }),
          } as T
        }
        if (name === "pty.write") {
          written += (payload as { data?: string })?.data ?? ""
          writes.push(name)
        }
        return {} as T
      },
    }
    return { rpc, writes }
  }

  it("delivers into a live session", async () => {
    const { rpc, writes } = echoingRpc("\u276f")
    const outcome = await deliverToHostedKey(rpc, "t1::tab-1", "go")
    expect(outcome).toMatchObject({ ready: true, confirmed: true })
    expect(writes).toEqual(["pty.write", "pty.write"])
  })

  it("delivers even when the composer already holds text and someone just typed", async () => {
    // The delivery gate that used to hold this back is gone: `send` pastes and
    // submits, and the only refusal left is a session that cannot take bytes.
    const { rpc, writes } = echoingRpc("\u276f hello", { lastHumanWriteMs: Date.now() })
    const outcome = await deliverToHostedKey(rpc, "t1::tab-1", "go")
    expect(outcome).toMatchObject({ ready: true, confirmed: true })
    expect(writes).toEqual(["pty.write", "pty.write"])
  })

  it("reports null for a dead session instead of writing", async () => {
    const writes: string[] = []
    const rpc: HostedSessionRpc = {
      request: async <T>(name: string): Promise<T> => {
        if (name === "pty.peek") return { exists: true, alive: false, offset: 0, data: "" } as T
        if (name === "pty.write") writes.push(name)
        return {} as T
      },
    }
    expect(await deliverToHostedKey(rpc, "t1::tab-1", "go")).toBeNull()
    expect(writes).toEqual([])
  })
})
