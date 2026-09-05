/**
 * `exact-tab-delivery.ts` — `send --tab tab-N`, delivery into ONE addressed
 * tab. Split from `pty-delivery.test.ts` along the same seam as the source:
 * that file owns delivery through the canonical path (find the task's engine
 * session, or create it); this one owns delivery when the caller named the
 * tab, including the case where the tab is GONE — absent, a plain shell, or
 * thawed-but-dead after a pty-host restart. The composer-busy gates on the
 * same function live in `pty-delivery-gates.test.ts`.
 */

import type { PtySessionInfo } from "@sma1lboy/kobe-daemon/daemon/pty-host"
import { describe, expect, it } from "vitest"
import { deliverToExactTab } from "../../src/cli/api/exact-tab-delivery.ts"
import type { ApiError } from "../../src/cli/api/types.ts"

function session(key: string, command: string[], alive = true): PtySessionInfo {
  return { key, alive, pid: alive ? 123 : null, command, title: "" }
}

/** A ps snapshot in which pid 123 (the session shell) hosts `child`. */
function psWith(child: string): () => Promise<string> {
  return async () => `123 1 -zsh\n456 123 ${child}\n`
}

/**
 * A fake engine that has announced bracketed paste and echoes what it was
 * written, the way a real composer redraws pasted text. Delivery waits for
 * the announce before writing and confirms the prompt's tail on capture, so
 * a silent fake would poll until its confirm budget expired.
 */
function echoingPeek(): { onWrite: (data: string) => void; peek: () => unknown } {
  let buffer = ""
  return {
    onWrite: (data: string) => {
      buffer += data
    },
    peek: () => ({
      exists: true,
      alive: true,
      data: Buffer.from(`\x1b[?2004h${buffer}`).toString("base64"),
      offset: 0,
    }),
  }
}

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

  // A pty-host restart leaves every tab thawed-but-dead. TAB_NOT_FOUND for
  // one of those sent the caller to `pty-list`, which LISTS it — so the
  // refusal has to be its own code, and reviving has to be reachable.
  it("distinguishes a freeze-restored tab from an absent one (TAB_RESTORED, not TAB_NOT_FOUND)", async () => {
    const { rpc, calls } = rpcWith([{ ...session("t1::tab-2", ["claude"], false), restored: true }])
    const err = await deliverToExactTab(rpc, "t1", "tab-2", "/wt/t1", "go").then(
      () => null,
      (e) => e,
    )
    expect((err as ApiError).code).toBe("TAB_RESTORED")
    // Refusal, not a silent revival: nothing was opened and nothing written.
    expect(calls).not.toContain("pty.open")
    expect(calls).not.toContain("pty.write")
  })

  it("respawns a freeze-restored tab and delivers into it when the caller opts in", async () => {
    const restored = { ...session("t1::tab-2", ["claude"], false), restored: true }
    const sessions: PtySessionInfo[] = [restored]
    const { rpc, calls } = rpcWith(sessions)
    const inner = rpc.request
    rpc.request = async <T>(name: string, payload?: unknown): Promise<T> => {
      const out = await inner<T>(name, payload)
      // The host's respawn-in-place: the same key comes back alive.
      if (name === "pty.open") sessions[0] = session("t1::tab-2", ["claude"])
      return name === "pty.open" ? ({ alive: true, respawned: true } as T) : out
    }
    const result = await deliverToExactTab(rpc, "t1", "tab-2", "/wt/t1", "go", {
      engineBin: "claude",
      snapshot: psWith("claude"),
      respawn: () => ({ key: "t1::tab-2", command: ["zsh", "-lc", "claude --resume abc"] }),
    })
    expect(calls).toContain("pty.open")
    // `respawned`, never `started`: the SAME tab came back, scrollback and
    // conversation intact — a new session would be a different claim.
    expect(result).toMatchObject({ session: "t1::tab-2", delivered: true, respawned: true, started: false })
  })

  // The one SESSION_FAILED outside runtime.ts's shared constructor. Its
  // message names the task, but a caller that parses the envelope reads
  // `data` — and an unattended fan-out reading only `message` would have to
  // scrape prose for the id of a task it just created.
  it("a respawn that never comes back fails with the task and tab in the envelope", async () => {
    const restored = { ...session("t1::tab-2", ["claude"], false), restored: true }
    const { rpc } = rpcWith([restored])
    const inner = rpc.request
    rpc.request = async <T>(name: string, payload?: unknown): Promise<T> =>
      name === "pty.open" ? ({ alive: false, respawned: false } as T) : inner<T>(name, payload)
    const err = (await deliverToExactTab(rpc, "t1", "tab-2", "/wt/t1", "go", {
      engineBin: "claude",
      respawn: () => ({ key: "t1::tab-2", command: ["zsh", "-lc", "claude"] }),
    }).then(
      () => null,
      (e) => e,
    )) as ApiError
    expect(err.code).toBe("SESSION_FAILED")
    expect(err.data).toMatchObject({ taskId: "t1", tabId: "tab-2" })
    expect(err.data?.nextCommandArgs).toEqual([
      "api",
      "read-output",
      "--task-id",
      "t1",
      "--tab",
      "tab-2",
      "--source",
      "terminal",
    ])
  })
})
