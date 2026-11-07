/**
 * `ports` — which TCP listeners belong to a task. Pins attribution by the
 * listener's cwd (extra repos included, the deepest checkout wins),
 * the "couldn't scan" null, and that the real scan sees a live listener.
 */

import { createServer } from "node:net"
import { describe, expect, it } from "vitest"
import { invokeVerb } from "../../src/cli/api-cmd.ts"
import {
  type ListeningSocket,
  parseLsofListeners,
  parseProcNetTcp,
  scanListeningPorts,
} from "../../src/cli/api/listening-ports.ts"
import { FakeClient, expectApiError, stubRuntime, taskFixture } from "./api-handler-fixtures.ts"

const SOCKETS: ListeningSocket[] = [
  { port: 3000, host: "*", pid: 11, command: "node", cwd: "/wt/t1/web" },
  { port: 5173, host: "127.0.0.1", pid: 12, command: "vite", cwd: "/wt/t1-api" },
  { port: 8080, host: "10.0.0.5", pid: 13, command: "python3", cwd: "/repo/x/tools" },
  { port: 9229, host: "::1", pid: 14, command: "node", cwd: "/wt/t10" },
  { port: 6379, host: "*", pid: 15, command: "redis-server", cwd: null },
  { port: 4000, host: "::ffff:127.0.0.1", pid: 16, command: "java", cwd: null },
]

const T1 = taskFixture({
  extraRepos: [{ name: "api", repo: "/repo/api", branch: "rove/t-t1", worktreePath: "/wt/t1-api" }],
})
const MAIN = taskFixture({ id: "main", worktreePath: "/repo/x" })
const T10 = taskFixture({ id: "t10", worktreePath: "/wt/t10" })

function client() {
  return new FakeClient({
    "task.get": () => ({ task: T1 }),
    "task.list": () => ({ tasks: [MAIN, T1, T10] }),
  })
}

describe("ports", () => {
  it("lists only listeners running inside the task's checkouts, extra repos included", async () => {
    const out = await invokeVerb("ports", ["--task-id", "t1"], {
      client: client(),
      runtime: stubRuntime({ listeningPorts: async () => SOCKETS }),
    })
    expect(out).toEqual({
      taskId: "t1",
      ports: [
        { ...SOCKETS[0], url: "http://localhost:3000" },
        { ...SOCKETS[1], url: "http://localhost:5173" },
      ],
    })
  })

  it("--all tags each listener with the deepest owning checkout, null when none", async () => {
    const nested = taskFixture({ id: "nested", worktreePath: "/repo/x/tools" })
    const c = new FakeClient({ "task.list": () => ({ tasks: [MAIN, nested, T1, T10] }) })
    const out = (await invokeVerb("ports", ["--all"], {
      client: c,
      runtime: stubRuntime({ listeningPorts: async () => SOCKETS }),
    })) as { ports: Array<{ port: number; taskId: string | null; url: string }> }
    expect(out.ports.map((p) => [p.port, p.taskId, p.url])).toEqual([
      [3000, "t1", "http://localhost:3000"],
      [5173, "t1", "http://localhost:5173"],
      [8080, "nested", "http://10.0.0.5:8080"],
      [9229, "t10", "http://localhost:9229"],
      [6379, null, "http://localhost:6379"],
      [4000, null, "http://localhost:4000"],
    ])
  })

  it.each(["primary", "extra"])("task filtering respects a nested %s checkout's ownership", async (kind) => {
    const parent = taskFixture({ id: "parent", worktreePath: "/repo" })
    const child = taskFixture({
      id: "child",
      worktreePath: kind === "primary" ? "/repo/nested" : "/elsewhere",
      extraRepos:
        kind === "extra" ? [{ name: "nested", repo: "/source", branch: "child", worktreePath: "/repo/nested" }] : [],
    })
    const socket = { port: 3000, host: "127.0.0.1", pid: 123, command: "node", cwd: "/repo/nested" }
    const c = new FakeClient({
      "task.get": (payload) => ({
        task:
          typeof payload === "object" && payload !== null && "taskId" in payload && payload.taskId === "parent"
            ? parent
            : child,
      }),
      "task.list": () => ({ tasks: [parent, child] }),
    })
    const deps = { client: c, runtime: stubRuntime({ listeningPorts: async () => [socket] }) }
    const row = { ...socket, url: "http://localhost:3000" }
    expect(await invokeVerb("ports", ["--all"], deps)).toEqual({ ports: [{ ...row, taskId: "child" }] })
    expect(await invokeVerb("ports", ["--task-id", "parent"], deps)).toEqual({ taskId: "parent", ports: [] })
    expect(await invokeVerb("ports", ["--task-id", "child"], deps)).toEqual({ taskId: "child", ports: [row] })
  })

  it("rejects a missing task even when no listeners exist", async () => {
    const c = new FakeClient({
      "task.get": () => {
        throw new Error("Task not found: missing")
      },
      "task.list": () => ({ tasks: [] }),
    })
    await expect(
      invokeVerb("ports", ["--task-id", "missing"], {
        client: c,
        runtime: stubRuntime({ listeningPorts: async () => [] }),
      }),
    ).rejects.toThrow("Task not found: missing")
  })

  it("a failed scan answers null, never an empty list", async () => {
    const out = await invokeVerb("ports", ["--task-id", "t1"], {
      client: client(),
      runtime: stubRuntime({ listeningPorts: async () => null }),
    })
    expect(out).toEqual({ taskId: "t1", ports: null })
  })

  it("needs exactly one of --task-id and --all", async () => {
    const runtime = stubRuntime()
    await expectApiError(() => invokeVerb("ports", [], { client: client(), runtime }), "MISSING_FLAG")
    await expectApiError(
      () => invokeVerb("ports", ["--all", "--task-id", "t1"], { client: client(), runtime }),
      "BAD_FLAG",
    )
  })
})

describe("listener parsing", () => {
  it("reads LISTEN rows from /proc/net/tcp and tcp6, skipping connected sockets", () => {
    const tcp = [
      "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      "   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 4242 1 0000000000000000 100 0 0 10 0",
      "   1: 0100007F:0BB8 0100007F:D431 01 00000000:00000000 00:00000000 00000000  1000        0 4343 1 0000000000000000 20 4 30 10 -1",
    ].join("\n")
    const tcp6 = [
      "  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      "   0: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 5151 1 0000000000000000 100 0 0 10 0",
    ].join("\n")
    expect([...parseProcNetTcp(tcp)]).toEqual([["4242", { host: "127.0.0.1", port: 3000 }]])
    expect([...parseProcNetTcp(tcp6)]).toEqual([["5151", { host: "::", port: 8080 }]])
  })

  it("prints tcp6 addresses the way lsof does: dotted IPv4-mapped, zero runs compressed", () => {
    const row = (inode: number, addr: string) =>
      `   0: ${addr}:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 ${inode} 1 0000000000000000 100 0 0 10 0`
    const tcp6 = [
      "  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      row(1, "0000000000000000FFFF00000100007F"),
      row(2, "000080FE000000000000000001000000"),
      row(3, "B80D0120000000000000010001000000"),
    ].join("\n")
    expect([...parseProcNetTcp(tcp6)].map(([, r]) => r.host)).toEqual([
      "::ffff:127.0.0.1",
      "fe80::1",
      "2001:db8::1:0:0:1",
    ])
  })

  it("reads lsof field output, one row per socket", () => {
    const out = ["p501", "cnode", "f22", "n*:3000", "f23", "n[::1]:9229", "p777", "cvite", "f30", "n127.0.0.1:5173", ""]
    expect(parseLsofListeners(out.join("\n"))).toEqual([
      { port: 3000, host: "*", pid: 501, command: "node" },
      { port: 9229, host: "::1", pid: 501, command: "node" },
      { port: 5173, host: "127.0.0.1", pid: 777, command: "vite" },
    ])
  })

  it.runIf(process.platform === "linux")("the real scan sees this process's listener and its cwd", async () => {
    const server = createServer()
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
    try {
      const port = (server.address() as { port: number }).port
      const rows = await scanListeningPorts()
      expect(rows?.find((r) => r.port === port)).toMatchObject({ pid: process.pid, cwd: process.cwd() })
    } finally {
      server.close()
    }
  })
})
