/**
 * `pty-delivery.ts` — the bracketed paste that `kobe api` delivery routes
 * through. The engine-key resolver's own tests live in
 * `pty-engine-key.test.ts`.
 */

import type { PtySessionInfo } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import { describe, expect, it } from "vitest"
import { deliverHostedPrompt, deliverToExactTab, deliverToKey } from "../../src/cli/api/pty-delivery.ts"
import { ApiError } from "../../src/cli/api/types.ts"

function session(key: string, command: string[], alive = true): PtySessionInfo {
  return { key, alive, pid: alive ? 123 : null, command, title: "" }
}

/** A ps snapshot in which pid 123 (the session shell) hosts `child`. */
function psWith(child: string): () => Promise<string> {
  return async () => `123 1 -zsh\n456 123 ${child}\n`
}

/**
 * A `pty.peek` reply from an engine that has announced bracketed paste, i.e.
 * one that is in raw mode and READING. Delivery now waits for exactly this
 * before writing — a prompt written into the pre-raw window is truncated at
 * the tty's 1024-byte canonical buffer (see `pty-large-prompt.test.ts`).
 */
function readyPeek(echo = ""): { exists: boolean; alive: boolean; data: string; offset: number } {
  return { exists: true, alive: true, data: Buffer.from(`\x1b[?2004h${echo}`).toString("base64"), offset: 0 }
}

/**
 * A fake engine that echoes what it was written, the way a real composer
 * redraws pasted text. Delivery confirms the prompt's tail on capture, so a
 * fake that stayed silent would poll until its confirm budget expired.
 */
function echoingPeek(): { seen: () => string; onWrite: (data: string) => void; peek: () => unknown } {
  let buffer = ""
  return {
    seen: () => buffer,
    onWrite: (data: string) => {
      buffer += data
    },
    peek: () => readyPeek(buffer),
  }
}

describe("deliverToKey", () => {
  function recorder() {
    const calls: Array<{ name: string; payload: unknown }> = []
    const engine = echoingPeek()
    const rpc = {
      request: async <T>(name: string, payload?: unknown): Promise<T> => {
        calls.push({ name, payload })
        if (name === "pty.peek") return engine.peek() as T
        if (name === "pty.write") engine.onWrite((payload as { data?: string }).data ?? "")
        return {} as T
      },
    }
    return { rpc, calls }
  }

  it("peeks (never attaches/resizes) then writes bracketed prompt + deferred CR", async () => {
    const { rpc, calls } = recorder()
    const ok = await deliverToKey(rpc, "t1::tab-1", "do the thing")
    // The outcome is OBSERVED, not assumed: it carries the byte count,
    // the readiness verdict, and whether the tail was echoed back.
    expect(ok).toMatchObject({ ready: true, confirmed: true })
    // pty.peek, NOT pty.open: an open would last-attach-wins resize the
    // live session away from its attached TUI — delivery must
    // be indistinguishable from keyboard input (pure pty.write).
    // Peeks (gate, readiness, confirm) then two writes — still no open/resize.
    expect(calls.map((c) => c.name)).toEqual(["pty.peek", "pty.peek", "pty.write", "pty.write", "pty.peek"])
    expect(calls[0].payload).toEqual({ key: "t1::tab-1" })
    // Bracketed paste markers wrap the prompt; the CR is a SEPARATE write.
    expect(calls[2].payload).toEqual({ key: "t1::tab-1", data: "\x1b[200~do the thing\x1b[201~" })
    expect(calls[3].payload).toEqual({ key: "t1::tab-1", data: "\r" })
  })

  it("returns false without writing when the session is dead", async () => {
    const calls: Array<{ name: string }> = []
    const rpc = {
      request: async <T>(name: string): Promise<T> => {
        calls.push({ name })
        if (name === "pty.peek") return { exists: true, alive: false, data: "", offset: 0 } as T
        return {} as T
      },
    }
    expect(await deliverToKey(rpc, "t1::tab-1", "x")).toBeNull()
    expect(calls.map((c) => c.name)).toEqual(["pty.peek"]) // no write into a dead pty
  })
})

describe("deliverHostedPrompt", () => {
  it("starts the canonical engine session with the explicit prompt already in its launch argv", async () => {
    const calls: Array<{ name: string; payload: unknown }> = []
    const rpc = {
      request: async <T>(name: string, payload?: unknown): Promise<T> => {
        calls.push({ name, payload })
        if (name === "pty.list") return { sessions: [] } as T
        if (name === "pty.open") return { replay: "", alive: true, created: true } as T
        return {} as T
      },
    }

    const result = await deliverHostedPrompt(rpc, { id: "t1", engineBin: "claude" }, "/wt/t1", "fix it", {
      key: "t1::tab-1",
      command: ["/bin/zsh", "-ilc", "claude 'fix it'"],
    })

    expect(calls.map((call) => call.name)).toEqual(["pty.list", "pty.open", "pty.detach"])
    expect(calls[1].payload).toMatchObject({
      key: "t1::tab-1",
      cwd: "/wt/t1",
      command: ["/bin/zsh", "-ilc", "claude 'fix it'"],
    })
    expect(result).toEqual({
      session: "t1::tab-1",
      pane: "t1::tab-1",
      started: true,
      engineReady: true,
      delivered: true,
    })
  })

  it("delivers once when another caller wins the create race", async () => {
    const calls: Array<{ name: string; payload: unknown }> = []
    const engine = echoingPeek()
    const rpc = {
      request: async <T>(name: string, payload?: unknown): Promise<T> => {
        calls.push({ name, payload })
        if (name === "pty.list") return { sessions: [] } as T
        if (name === "pty.open") return { replay: "", alive: true, created: false } as T
        if (name === "pty.peek") return engine.peek() as T
        if (name === "pty.write") engine.onWrite((payload as { data?: string }).data ?? "")
        return {} as T
      },
    }

    const result = await deliverHostedPrompt(rpc, { id: "t1", engineBin: "claude" }, "/wt/t1", "fix it", {
      key: "t1::tab-1",
      command: ["/bin/zsh", "-ilc", "claude 'fix it'"],
    })

    expect(calls.map((call) => call.name)).toEqual([
      "pty.list",
      "pty.open",
      "pty.peek",
      "pty.peek",
      "pty.write",
      "pty.write",
      "pty.peek",
      "pty.detach",
    ])
    expect(result).toMatchObject({ started: false, delivered: true, promptEcho: "confirmed" })
  })

  it("delivers into an existing engine when the foreground gate sees the engine process", async () => {
    const calls: string[] = []
    const engine = echoingPeek()
    const rpc = {
      request: async <T>(name: string, payload?: unknown): Promise<T> => {
        calls.push(name)
        if (name === "pty.list") return { sessions: [session("t1::tab-1", ["claude"])] } as T
        if (name === "pty.peek") return engine.peek() as T
        if (name === "pty.write") engine.onWrite((payload as { data?: string }).data ?? "")
        return {} as T
      },
    }
    const result = await deliverHostedPrompt(
      rpc,
      { id: "t1", engineBin: "claude" },
      "/wt/t1",
      "go",
      { key: "t1::tab-1", command: ["claude"] },
      { snapshot: psWith("claude") },
    )
    expect(result).toMatchObject({ started: false, delivered: true })
    expect(calls).toContain("pty.write")
  })

  it("delivers into a surviving shell-wrapped engine tab instead of spawning", async () => {
    // The shape that breaks: tab-1 dead, tab-2 a live shell-wrapped engine.
    // Spawning here mints a fresh unsandboxed engine at launch.key and
    // returns ok while tab-2 never sees the prompt.
    const calls: string[] = []
    const engine = echoingPeek()
    const rpc = {
      request: async <T>(name: string, payload?: unknown): Promise<T> => {
        calls.push(name)
        if (name === "pty.list")
          return {
            sessions: [
              session("t1::tab-1", ["/bin/zsh", "-ilc", "claude 'x'"], false),
              session("t1::tab-2", ["/bin/zsh", "-ilc", "claude '--resume' 'x'"]),
            ],
          } as T
        if (name === "pty.peek") return engine.peek() as T
        if (name === "pty.write") engine.onWrite((payload as { data?: string }).data ?? "")
        return {} as T
      },
    }
    const result = await deliverHostedPrompt(
      rpc,
      { id: "t1", engineBin: "claude" },
      "/wt/t1",
      "go",
      { key: "t1::tab-1", command: ["/bin/zsh", "-ilc", "claude 'go'"] },
      { snapshot: psWith("claude") },
    )
    expect(result).toMatchObject({ session: "t1::tab-2", started: false, delivered: true })
    expect(calls).not.toContain("pty.open") // NEVER a new engine while one lives
  })

  it("FAILS LOUD instead of spawning when live tabs exist but none is an engine (issue #19)", async () => {
    // A live shell tab, no engine anywhere: pre-fix this silently booted a
    // brand-new engine at tab-1 and reported ok — sender and receiver both
    // believed the message arrived. It must be a typed error instead.
    const calls: string[] = []
    const engine = echoingPeek()
    const rpc = {
      request: async <T>(name: string, payload?: unknown): Promise<T> => {
        calls.push(name)
        if (name === "pty.list") return { sessions: [session("t1::tab-2", ["/bin/zsh", "-il"])] } as T
        return {} as T
      },
    }
    const err = await deliverHostedPrompt(rpc, { id: "t1", engineBin: "claude" }, "/wt/t1", "go", {
      key: "t1::tab-1",
      command: ["/bin/zsh", "-ilc", "claude 'go'"],
    }).then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe("NO_ENGINE_TAB")
    expect((err as ApiError).data).toMatchObject({ nextCommandArgs: ["api", "pty-list"] })
    expect(calls).not.toContain("pty.open") // no session was created
    expect(calls).not.toContain("pty.write") // and nothing was pasted anywhere
  })

  it("bare send reaches a live non-tab-1 engine instead of refusing (issue #36)", async () => {
    // End-to-end shape of the report: the task's only live tab is tab-22
    // running plain `claude` while the task's vendor is the `claudecpa`
    // preset. Pre-fix the resolver returned null and this threw
    // NO_ENGINE_TAB with the engine sitting right there.
    const calls: string[] = []
    const engine = echoingPeek()
    const rpc = {
      request: async <T>(name: string, payload?: unknown): Promise<T> => {
        calls.push(name)
        if (name === "pty.list")
          return {
            sessions: [session("t1::tab-22", ["/bin/zsh", "-ilc", "export KOBE_TAB_ID='tab-22'\nclaude"])],
          } as T
        if (name === "pty.peek") return engine.peek() as T
        if (name === "pty.write") engine.onWrite((payload as { data?: string }).data ?? "")
        return {} as T
      },
    }
    const result = await deliverHostedPrompt(
      rpc,
      { id: "t1", engineBin: "claudecpa" },
      "/wt/t1",
      "go",
      { key: "t1::tab-1", command: ["/bin/zsh", "-ilc", "claudecpa 'go'"] },
      { snapshot: psWith("claude") },
    )
    expect(result).toMatchObject({ session: "t1::tab-22", started: false, delivered: true })
    expect(calls).not.toContain("pty.open") // delivered into the live tab, never spawned
  })

  it("a freeze-RESTORED corpse is respawned in place — never killed, prompt not pasted twice", async () => {
    // After a pty-host restart the canonical session lists as a dead,
    // restored corpse. Delivery must NOT pty.kill it (the open respawns it,
    // keeping the pre-restart scrollback) and must NOT writePrompt after
    // the respawn (the prompt already rode the launch argv).
    const calls: Array<{ name: string; payload?: unknown }> = []
    const rpc = {
      request: async <T>(name: string, payload?: unknown): Promise<T> => {
        calls.push({ name, payload })
        if (name === "pty.list")
          return {
            sessions: [{ ...session("t1::tab-1", ["/bin/zsh", "-ilc", "claude 'x'"], false), restored: true }],
          } as T
        if (name === "pty.open") return { replay: "b2xk", alive: true, created: false, respawned: true } as T
        return {} as T
      },
    }
    const result = await deliverHostedPrompt(rpc, { id: "t1", engineBin: "claude" }, "/wt/t1", "go", {
      key: "t1::tab-1",
      command: ["/bin/zsh", "-ilc", "claude 'go'"],
    })
    expect(result).toMatchObject({ session: "t1::tab-1", started: true, delivered: true })
    expect(calls.map((c) => c.name)).toEqual(["pty.list", "pty.open", "pty.detach"])
  })

  it("still first-starts the canonical engine when only DEAD sessions remain, cwd'd at the worktree", async () => {
    const calls: Array<{ name: string; payload: unknown }> = []
    const rpc = {
      request: async <T>(name: string, payload?: unknown): Promise<T> => {
        calls.push({ name, payload })
        if (name === "pty.list")
          return { sessions: [session("t1::tab-1", ["/bin/zsh", "-ilc", "claude 'x'"], false)] } as T
        if (name === "pty.open") return { replay: "", alive: true, created: true } as T
        return {} as T
      },
    }
    const result = await deliverHostedPrompt(rpc, { id: "t1", engineBin: "claude" }, "/wt/t1", "go", {
      key: "t1::tab-1",
      command: ["/bin/zsh", "-ilc", "claude 'go'"],
    })
    // started:true is the "a NEW session was created" marker.
    expect(result).toMatchObject({ session: "t1::tab-1", started: true, delivered: true })
    const open = calls.find((c) => c.name === "pty.open")
    expect(open?.payload).toMatchObject({ cwd: "/wt/t1" }) // the task's worktree, never the caller's repo
  })

  it("REFUSES an existing session whose engine exited into the keepAlive shell", async () => {
    const rpc = {
      request: async <T>(name: string): Promise<T> => {
        if (name === "pty.list") return { sessions: [session("t1::tab-1", ["claude"])] } as T
        throw new Error(`unexpected rpc ${name}`)
      },
    }
    const err = await deliverHostedPrompt(
      rpc,
      { id: "t1", engineBin: "claude" },
      "/wt/t1",
      "go",
      { key: "t1::tab-1", command: ["claude"] },
      { snapshot: psWith("/bin/sh") }, // keepAlive fallback: shell only
    ).then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe("ENGINE_NOT_RUNNING")
  })
})

describe("deliverToExactTab", () => {
  function rpcWith(sessions: PtySessionInfo[]) {
    const calls: string[] = []
    const engine = echoingPeek()
    const rpc = {
      request: async <T>(name: string, payload?: unknown): Promise<T> => {
        calls.push(name)
        if (name === "pty.list") return { sessions } as T
        if (name === "pty.peek") return engine.peek() as T
        if (name === "pty.write") engine.onWrite((payload as { data?: string }).data ?? "")
        return {} as T
      },
    }
    return { rpc, calls }
  }

  it("a DIFFERENT vendor's engine in the addressed tab still receives (cross-vendor send)", async () => {
    const { rpc, calls } = rpcWith([session("t1::tab-2", ["codex"])])
    const result = await deliverToExactTab(rpc, "t1", "tab-2", "/wt/t1", "go", {
      engineBin: "claude", // task vendor is claude; tab runs codex
      snapshot: psWith("codex"),
    })
    expect(result).toMatchObject({ session: "t1::tab-2", delivered: true })
    expect(calls).toContain("pty.write")
  })

  it("refuses a tab that is a plain shell (ENGINE_NOT_RUNNING, not a paste)", async () => {
    const { rpc, calls } = rpcWith([session("t1::tab-2", ["/bin/zsh"])])
    const err = await deliverToExactTab(rpc, "t1", "tab-2", "/wt/t1", "go", {
      snapshot: psWith("grep something"),
    }).then(
      () => null,
      (e) => e,
    )
    expect((err as ApiError).code).toBe("ENGINE_NOT_RUNNING")
    expect(calls).not.toContain("pty.write")
  })

  it("refuses a dead/absent tab (TAB_NOT_FOUND)", async () => {
    const { rpc } = rpcWith([session("t1::tab-2", ["claude"], false)])
    const err = await deliverToExactTab(rpc, "t1", "tab-2", "/wt/t1", "go").then(
      () => null,
      (e) => e,
    )
    expect((err as ApiError).code).toBe("TAB_NOT_FOUND")
  })
})
