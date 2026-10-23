/**
 * `engine.maxLiveSessions` at the spawn point of `pty-delivery.ts`: a new
 * engine session is refused at the cap, delivery into a running one never is.
 */

import type { PtySessionInfo } from "@sma1lboy/rove-daemon/daemon/pty-host"
import { describe, expect, it } from "vitest"
import { deliverHostedPrompt } from "../../src/cli/api/pty-delivery.ts"
import { ApiError } from "../../src/cli/api/types.ts"

function session(key: string, command: string[], alive = true): PtySessionInfo {
  return { key, alive, pid: alive ? 123 : null, command, title: "" }
}

function psWith(child: string): () => Promise<string> {
  return async () => `123 1 -zsh\n456 123 ${child}\n789 1 /bin/zsh\n`
}

/** An engine in raw mode (bracketed paste on) that echoes what it is written. */
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

describe("deliverHostedPrompt engine.maxLiveSessions", () => {
  // Two live engines: a canonical tab and a shell-wrapped extra tab. A split
  // leaf, a plain shell tab and a dead session never count against the cap.
  const fleet = [
    session("a::tab-1", ["/bin/zsh", "-ilc", "codex"]),
    session("b::tab-3", ["/bin/zsh", "-ilc", "claude"]),
    session("b::tab-3::leaf-2", ["/bin/zsh", "-ilc", "claude"]),
    { ...session("c::tab-2", ["/bin/zsh"]), pid: 789 },
    session("d::tab-1", ["claude"], false),
  ]

  function fleetRpc(extra: PtySessionInfo[] = []) {
    const calls: string[] = []
    const rpc = {
      request: async <T>(name: string): Promise<T> => {
        calls.push(name)
        if (name === "pty.list") return { sessions: [...fleet, ...extra], admissionToken: "test" } as T
        if (name === "pty.openChecked") return { kind: "opened", open: { replay: "", alive: true, created: true } } as T
        return {} as T
      },
    }
    return { rpc, calls }
  }

  const launch = { key: "t1::tab-1", command: ["/bin/zsh", "-ilc", "claude 'go'"] }

  it("refuses a new session once the live engines reach the cap, starting nothing", async () => {
    const { rpc, calls } = fleetRpc()
    const err = await deliverHostedPrompt(rpc, { id: "t1", engineBin: "claude" }, "/wt/t1", "go", launch, {
      snapshot: psWith("claude"),
      maxLiveEngines: 2,
    }).then(
      () => null,
      (e) => e,
    )
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe("ENGINE_LIMIT")
    expect((err as ApiError).data).toMatchObject({
      taskId: "t1",
      live: 2,
      limit: 2,
      nextCommandArgs: ["api", "send", "--task-id", "t1", "--plain", "--prompt", "go"],
    })
    expect(calls).not.toContain("pty.openChecked")
  })

  it("starts the session while the fleet is under the cap", async () => {
    const { rpc, calls } = fleetRpc()
    const result = await deliverHostedPrompt(rpc, { id: "t1", engineBin: "claude" }, "/wt/t1", "go", launch, {
      snapshot: psWith("claude"),
      maxLiveEngines: 3,
    })
    expect(result).toMatchObject({ started: true })
    expect(calls).toContain("pty.openChecked")
  })

  it("still delivers into a task's running engine at the cap — only new sessions are limited", async () => {
    const engine = echoingPeek()
    const rpc = {
      request: async <T>(name: string, payload?: unknown): Promise<T> => {
        if (name === "pty.list") return { sessions: [...fleet, session("t1::tab-1", ["claude"])] } as T
        if (name === "pty.peek") return engine.peek() as T
        if (name === "pty.write") engine.onWrite((payload as { data?: string }).data ?? "")
        if (name === "pty.open") throw new Error("must not spawn")
        return {} as T
      },
    }
    const result = await deliverHostedPrompt(rpc, { id: "t1", engineBin: "claude" }, "/wt/t1", "go", launch, {
      snapshot: psWith("claude"),
      maxLiveEngines: 1,
    })
    expect(result).toMatchObject({ session: "t1::tab-1", started: false, delivered: true })
  })
  it("releases slots after engines exit into keepAlive shells", async () => {
    const { rpc, calls } = fleetRpc()
    await deliverHostedPrompt(rpc, { id: "t1" }, "/wt/t1", "go", launch, {
      snapshot: psWith("sleep 10"),
      maxLiveEngines: 1,
    })
    expect(calls).toContain("pty.openChecked")
  })
})
