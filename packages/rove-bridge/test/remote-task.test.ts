import { afterEach, describe, expect, test } from "bun:test"
import type { ApiParams } from "@sma1lboy/rove-daemon/daemon/protocol"
import { createBridgeApi } from "../src/ops/api.ts"
import { FakePty, connect, fakeOps, start, stopServers } from "./server-harness.ts"

afterEach(stopServers)

describe("a task on another machine", () => {
  test("its terminal attaches through that machine's PTY host; input, resize and detach follow the stream", async () => {
    const far = new FakePty()
    const opened: string[] = []
    const h = start({
      ops: {
        ...fakeOps(),
        machineOf: (id) => (id === "T1" ? "mac" : undefined),
        worktreeOf: async () => "/Users/me/wt",
      },
      openMachinePty: async (alias) => {
        opened.push(alias)
        return far
      },
    })
    const c = await connect(h.url, { Authorization: `Bearer ${"t".repeat(43)}` })
    const attached = await c.call("term.attach", { taskId: "T1", tabId: "tab-1" })
    expect(attached.ok).toBe(true)
    await c.call("term.input", { stream: "T1::tab-1", data: "ls\r" })
    await c.call("term.resize", { stream: "T1::tab-1", cols: 100, rows: 30 })
    await c.call("term.detach", { stream: "T1::tab-1" })
    expect(opened).toEqual(["mac"])
    expect(far.calls.map(([name]) => name)).toEqual(["pty.list", "pty.open", "pty.write", "pty.resize", "pty.detach"])
    expect(far.calls[1]?.[1]).toMatchObject({ key: "T1::tab-1", cwd: "/Users/me/wt" })
    // This machine's PTY host never saw it.
    expect(h.pty.calls).toEqual([])
  })

  test("a machine the bridge cannot reach refuses the attach, and the next attach tries again", async () => {
    let tries = 0
    const h = start({
      ops: { ...fakeOps(), machineOf: () => "mac" },
      openMachinePty: async () => {
        tries++
        throw Object.assign(new Error('machine "mac" did not answer'), { code: "MACHINE_UNREACHABLE" })
      },
    })
    const c = await connect(h.url, { Authorization: `Bearer ${"t".repeat(43)}` })
    expect((await c.call("term.attach", { taskId: "T1", tabId: "tab-1" })).ok).toBe(false)
    expect((await c.call("term.attach", { taskId: "T1", tabId: "tab-1" })).ok).toBe(false)
    expect(tries).toBe(2)
  })
})

describe("verbs for a task on another machine", () => {
  const client = {
    request: async () => {
      throw new Error("the local daemon must not be asked")
    },
  } as never

  test("run inside that machine's daemon with the argv as params", async () => {
    const forwarded: Array<[string, string, ApiParams]> = []
    const api = createBridgeApi(client, {
      machineOf: (id) => (id === "far" ? "mac" : undefined),
      forward: async (alias, verb, params) => {
        forwarded.push([alias, verb, params])
        return { apiVersion: 1, ok: true, result: { files: ["a.ts"] } } as never
      },
    })
    expect(
      await api.verb<{ files: string[] }>("worktree-diff-file", [
        "--task-id",
        "far",
        "--path",
        "a.ts",
        "--scope",
        "working",
      ]),
    ).toEqual({
      files: ["a.ts"],
    })
    expect(forwarded).toEqual([["mac", "worktree-diff-file", { "task-id": "far", path: "a.ts", scope: "working" }]])
    expect(api.machineOf?.("far")).toBe("mac")
  })

  test("a refusal there keeps its code", async () => {
    const api = createBridgeApi(client, {
      machineOf: () => "mac",
      forward: async () =>
        ({
          apiVersion: 1,
          ok: false,
          error: { code: "NO_WORKTREE", message: "task far has no worktree yet" },
        }) as never,
    })
    await expect(api.verb("worktree-files", ["--task-id=far"])).rejects.toMatchObject({ code: "NO_WORKTREE" })
  })
})
