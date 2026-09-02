import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { CODEX_SCREEN_MANIFEST } from "../../src/engine/codex-local/screen.ts"
import {
  ComposerBusyError,
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

describe("pastePromptWhenEngineUp (issue #25 first-message paste delivery)", () => {
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

  it("waits for the init marker before budgeting engine-startup time (issue #73)", async () => {
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
        fs.writeFileSync(marker, "")
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

describe("deliverToHostedKey A+C gates (issue #78)", () => {
  function rpcWith(
    peek: Partial<{ alive: boolean; data: string; lastHumanWriteMs: number; humanWriteQuietMs: number }>,
  ) {
    let written = ""
    return {
      request: async <T>(name: string, payload?: unknown): Promise<T> => {
        if (name === "pty.write") {
          written += (payload as { data?: string })?.data ?? ""
          return {} as T
        }
        if (name === "pty.peek") {
          return {
            exists: true,
            alive: peek.alive !== false,
            pid: 42,
            offset: 0,
            // `pty.peek` returns BASE64, so the fake must encode too: the
            // readiness check decodes before looking for DECSET 2004.
            // Prefixed with 2004h so readiness passes and suffixed with the
            // echo so the capture confirmation does — the gates under test
            // here are the human-write and composer-empty ones.
            data: Buffer.concat([
              Buffer.from("\x1b[?2004h"),
              Buffer.from(peek.data ?? "", "base64"),
              Buffer.from(written),
            ]).toString("base64"),
            sinceValid: false,
            exit: null,
            ...(peek.lastHumanWriteMs !== undefined ? { lastHumanWriteMs: peek.lastHumanWriteMs } : {}),
            ...(peek.humanWriteQuietMs !== undefined ? { humanWriteQuietMs: peek.humanWriteQuietMs } : {}),
          } as T
        }
        return {} as T
      },
    }
  }

  const manifest = {
    rules: [],
    composerEmpty: [{ bottomLines: 2, all: ["❯"], lineRegex: ["^\\s*❯\\s*$"] }],
  }

  it("throws ComposerBusyError when a human write is recent", async () => {
    const rpc = rpcWith({ alive: true, lastHumanWriteMs: 1_000, humanWriteQuietMs: 10_000 })
    const err = await deliverToHostedKey(rpc as HostedSessionRpc, "t1::tab-1", "go", {
      now: () => 5_000,
    }).then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(ComposerBusyError)
    expect((err as ComposerBusyError).layer).toBe("recent-human-write")
  })

  it("throws ComposerBusyError when the composer is not empty", async () => {
    const rpc = rpcWith({ alive: true, data: Buffer.from("❯ hello", "utf8").toString("base64") })
    const err = await deliverToHostedKey(rpc as HostedSessionRpc, "t1::tab-1", "go", {
      screenManifest: manifest,
      // Pinned, not defaulted: the gate now falls back to the persisted
      // setting, so leaving this out made the assertion depend on whether the
      // machine running the suite had turned the switch off.
      composerGate: true,
    }).then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(ComposerBusyError)
    expect((err as ComposerBusyError).layer).toBe("composer-not-empty")
  })

  it("skips the screen check when the composer gate is off, but keeps the timing one", async () => {
    // The escape hatch (state/composer-gate.ts) for a screen rule an engine
    // redesign has outrun. It drops the LAYOUT read only: the A layer measures
    // keystroke recency, so a composer someone is typing into right now stays
    // protected however this is set — otherwise turning it off would trade a
    // stuck queue for messages landing mid-sentence.
    const busyScreen = { alive: true, data: Buffer.from("❯ hello", "utf8").toString("base64") }

    const cOff = await deliverToHostedKey(rpcWith(busyScreen) as HostedSessionRpc, "t1::tab-1", "go", {
      screenManifest: manifest,
      composerGate: false,
    }).then(
      () => "delivered",
      (e) => e,
    )
    expect(cOff).toBe("delivered")

    const aStillOn = await deliverToHostedKey(
      rpcWith({ ...busyScreen, lastHumanWriteMs: 1_000, humanWriteQuietMs: 10_000 }) as HostedSessionRpc,
      "t1::tab-1",
      "go",
      { screenManifest: manifest, composerGate: false, now: () => 5_000 },
    ).then(
      () => null,
      (e) => e,
    )
    expect(aStillOn).toBeInstanceOf(ComposerBusyError)
    expect((aStillOn as ComposerBusyError).layer).toBe("recent-human-write")
  })

  it("delivers when both gates pass", async () => {
    const writes: string[] = []
    let written = ""
    const rpc = {
      request: async <T>(name: string, payload?: unknown): Promise<T> => {
        if (name === "pty.peek") {
          return {
            exists: true,
            alive: true,
            pid: 42,
            offset: 0,
            // DECSET 2004 (engine is reading) + the empty-composer glyph +
            // whatever it has been written, so readiness and the capture
            // confirmation both settle on the first poll.
            data: Buffer.from(`\x1b[?2004h❯${written}`, "utf8").toString("base64"),
            sinceValid: false,
            exit: null,
          } as T
        }
        if (name === "pty.write") {
          written += (payload as { data?: string })?.data ?? ""
          writes.push(name)
          return {} as T
        }
        return {} as T
      },
    }
    const ok = await deliverToHostedKey(rpc as HostedSessionRpc, "t1::tab-1", "go", { screenManifest: manifest })
    // An observed outcome now, not a bare boolean.
    expect(ok).toMatchObject({ ready: true, confirmed: true })
    expect(writes).toEqual(["pty.write", "pty.write"])
  })

  it("delivers over Codex's empty-composer placeholder", async () => {
    const writes: string[] = []
    let written = ""
    const rpc: HostedSessionRpc = {
      request: async <T>(name: string, payload?: unknown): Promise<T> => {
        if (name === "pty.peek") {
          return {
            exists: true,
            alive: true,
            offset: 0,
            data: Buffer.from(
              `\x1b[?2004h› \x1b[2mAsk Codex to do anything\x1b[22m\r\n  gpt-5.6-sol high fast${written}`,
              "utf8",
            ).toString("base64"),
          } as T
        }
        if (name === "pty.write") {
          written += (payload as { data?: string })?.data ?? ""
          writes.push(name)
        }
        return {} as T
      },
    }

    const outcome = await deliverToHostedKey(rpc, "t1::tab-1", "go", {
      screenManifest: CODEX_SCREEN_MANIFEST,
      composerGate: true,
    })

    expect(outcome).toMatchObject({ ready: true, confirmed: true })
    expect(writes).toEqual(["pty.write", "pty.write"])
  })

  it("does not submit a Codex draft that equals the placeholder text", async () => {
    const writes: string[] = []
    const rpc: HostedSessionRpc = {
      request: async <T>(name: string): Promise<T> => {
        if (name === "pty.peek") {
          return {
            exists: true,
            alive: true,
            offset: 0,
            data: Buffer.from("\x1b[?2004h› Ask Codex to do anything", "utf8").toString("base64"),
          } as T
        }
        if (name === "pty.write") writes.push(name)
        return {} as T
      },
    }

    await expect(
      deliverToHostedKey(rpc, "t1::tab-1", "go", {
        screenManifest: CODEX_SCREEN_MANIFEST,
        composerGate: true,
      }),
    ).rejects.toBeInstanceOf(ComposerBusyError)
    expect(writes).toEqual([])
  })
})
