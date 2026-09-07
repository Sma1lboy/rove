/**
 * `rove api read-output --source terminal` WITHOUT `--tab`: which session it
 * resolves to.
 *
 * The engine is not always on tab-1 — tab-1 dies, or gets closed, and
 * `send --tab new` puts the replacement on tab-2. Resolution then falls to
 * matching the task's launch binary against each session's spawn argv, and
 * deriving that binary from the task's VENDOR alone loses every wrapper
 * command (`claudecpa`, any custom preset): a task whose tabs run `claudecpa`
 * was searched for as `claude`, matched nothing, and the verb answered "no
 * live terminal session for this task" while `--tab tab-2` returned a live
 * tail from the same task.
 *
 * The real `findEngineKey` runs here — only the pty host is faked — so this
 * pins the WIRING (which binary read-output hands the resolver), which is the
 * half that was wrong.
 */

import { describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ openPtyHost: vi.fn() }))

vi.mock("../../src/cli/api/pty-delivery.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/cli/api/pty-delivery.ts")>()),
  openPtyHost: mocks.openPtyHost,
}))

import { type ApiRuntime, invokeVerb } from "../../src/cli/api-cmd.ts"
import type { DaemonRpc } from "../../src/cli/daemon-session.ts"

const TAIL = "SENTINEL ENGINE UP argv: phase A\n"

/** Sessions as the pty host reports them: a dead tab-1, a live engine on tab-2. */
function sessions(engineWord: string) {
  return [
    { key: "t1::tab-1", alive: false, pid: null, command: ["/bin/zsh", "-ilc", `${engineWord} 'x'`], title: "" },
    { key: "t1::tab-2", alive: true, pid: 4242, command: ["/bin/zsh", "-ilc", `${engineWord} 'x'`], title: "" },
  ]
}

function fakeHost(engineWord: string) {
  const peeked: string[] = []
  mocks.openPtyHost.mockResolvedValue({
    rpc: {
      request: async (name: string, payload?: unknown) => {
        if (name === "pty.list") return { sessions: sessions(engineWord) }
        if (name === "pty.peek") {
          peeked.push((payload as { key: string }).key)
          return {
            exists: true,
            alive: true,
            pid: 4242,
            offset: TAIL.length,
            data: Buffer.from(TAIL).toString("base64"),
            sinceValid: true,
          }
        }
        throw new Error(`unexpected pty request ${name}`)
      },
    },
    close: () => {},
  })
  return peeked
}

function client(task: Record<string, unknown>): DaemonRpc {
  return {
    request: async <T>(name: string) => {
      if (name === "task.get") return { task } as T
      throw new Error(`fake daemon has no responder for "${name}"`)
    },
    subscribe: async () => ({}),
    onChannel: () => () => {},
  }
}

const runtime = { isTaskRunning: async () => true } as unknown as ApiRuntime

async function readTerminal(task: Record<string, unknown>) {
  return (await invokeVerb("read-output", ["--task-id", "t1", "--source", "terminal"], {
    client: client(task),
    runtime,
  })) as { terminal?: { tail?: unknown[]; live?: boolean }; warnings?: string[] }
}

describe("read-output resolves the engine tab from the task's own command", () => {
  it("finds a wrapper-command engine sitting on tab-2", async () => {
    const peeked = fakeHost("claudecpa")
    const out = await readTerminal({
      id: "t1",
      worktreePath: "/wt/t1",
      vendor: "claude",
      command: "claudecpa --model claude-opus-5[1m]",
    })

    expect(peeked).toEqual(["t1::tab-2"])
    expect(out.terminal?.live).toBe(true)
    expect(out.terminal?.tail).not.toEqual([])
    expect(out.warnings ?? []).not.toContain("no live terminal session for this task")
  })

  it("still finds a plain vendor engine on tab-2 when the task pins no command", async () => {
    const peeked = fakeHost("claude")
    const out = await readTerminal({ id: "t1", worktreePath: "/wt/t1", vendor: "claude" })

    expect(peeked).toEqual(["t1::tab-2"])
    expect(out.terminal?.live).toBe(true)
  })
})
