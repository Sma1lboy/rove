/** Tests for `rove api web <tab|nav|snap|batch|eval|fetch|handoff>`: argv normalization and local IPC round-trips. */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { type Server, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { invokeVerb } from "@sma1lboy/rove-api/cli/api-cmd.ts"
import { normalizeWebArgv } from "@sma1lboy/rove-api/cli/api/handlers-web.ts"
import { defaultDesktopBrowserSocketPath } from "@sma1lboy/rove-daemon/daemon/paths"
import { afterEach, describe, expect, it, vi } from "vitest"
import { expectApiError, stubRuntime } from "./api-handler-fixtures.ts"

const dirs: string[] = []
const servers: Server[] = []

async function startFakeDesktopIpc(
  onRequest: (req: { method: string; params: Record<string, unknown> }) => unknown,
): Promise<{ socketPath: string; requests: Array<{ method: string; params: Record<string, unknown> }> }> {
  const dir = mkdtempSync(join(tmpdir(), "rove-api-web-"))
  dirs.push(dir)
  const socketPath = join(dir, "desktop-browser.sock")
  const requests: Array<{ method: string; params: Record<string, unknown> }> = []
  const server = createServer((socket) => {
    socket.setEncoding("utf8")
    let buf = ""
    socket.on("data", (chunk: string) => {
      buf += chunk
      const nl = buf.indexOf("\n")
      if (nl === -1) return
      const req = JSON.parse(buf.slice(0, nl)) as { id: string; method: string; params?: Record<string, unknown> }
      buf = buf.slice(nl + 1)
      const entry = { method: req.method, params: req.params ?? {} }
      requests.push(entry)
      try {
        const result = onRequest(entry)
        socket.write(`${JSON.stringify({ id: req.id, ok: true, result })}\n`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        socket.write(`${JSON.stringify({ id: req.id, ok: false, error: { code: "TAB_NOT_FOUND", message: msg } })}\n`)
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(socketPath, () => resolve())
  })
  servers.push(server)
  return { socketPath, requests }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  while (servers.length) {
    const s = servers.pop()!
    await new Promise<void>((resolve) => s.close(() => resolve()))
  }
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe("normalizeWebArgv", () => {
  it("rewrites positional subcommands into canonical flags while keeping remaining flags intact", () => {
    expect(normalizeWebArgv(["snap", "--interactive", "--root", "@e3"])).toEqual([
      "--action",
      "snap",
      "--interactive",
      "--root",
      "@e3",
    ])
    expect(normalizeWebArgv(["tab", "handoff", "b-2", "--owner", "human"])).toEqual([
      "--action",
      "tab",
      "--tab-action",
      "handoff",
      "--id",
      "b-2",
      "--owner",
      "human",
    ])
    expect(normalizeWebArgv(["tab", "new", "https://example.com"])).toEqual([
      "--action",
      "tab",
      "--tab-action",
      "new",
      "--url",
      "https://example.com",
    ])
    expect(normalizeWebArgv(["nav", "back", "--id", "b-1"])).toEqual(["--action", "nav", "--go", "back", "--id", "b-1"])
    expect(normalizeWebArgv(["nav", "https://example.com"])).toEqual([
      "--action",
      "nav",
      "--url",
      "https://example.com",
    ])
    expect(normalizeWebArgv(["eval", "document.title"])).toEqual(["--action", "eval", "--expr", "document.title"])
    expect(normalizeWebArgv(["batch", '[{"action":"click","ref":"@e1"}]'])).toEqual([
      "--action",
      "batch",
      "--steps",
      '[{"action":"click","ref":"@e1"}]',
    ])
    expect(normalizeWebArgv(["fetch", "https://api.example.com/me", "--method", "POST"])).toEqual([
      "--action",
      "fetch",
      "--url",
      "https://api.example.com/me",
      "--method",
      "POST",
    ])
    expect(normalizeWebArgv(["handoff", "b-1"])).toEqual(["--action", "handoff", "--id", "b-1"])
    expect(normalizeWebArgv(["batch", "--id", "b-1", '[{"action":"click","ref":"@e1"}]'])).toEqual([
      "--action",
      "batch",
      "--steps",
      '[{"action":"click","ref":"@e1"}]',
      "--id",
      "b-1",
    ])
  })
})

describe("rove api web", () => {
  it("dispatches tab, nav, snap, batch, eval, fetch, and handoff over the local desktop IPC socket", async () => {
    const { socketPath, requests } = await startFakeDesktopIpc(({ method, params }) => ({ ok: true, method, params }))
    vi.stubEnv("ROVE_DESKTOP_BROWSER_SOCKET_PATH", socketPath)
    vi.stubEnv("ROVE_TASK_ID", "task-42")
    const deps = { client: null, runtime: stubRuntime() }

    await invokeVerb("web", ["tab", "list"], deps)
    await invokeVerb("web", ["tab", "handoff", "b-3", "--owner", "human", "--reason", "Sign in"], deps)
    await invokeVerb("web", ["nav", "https://github.com/Sma1lboy/rove"], deps)
    await invokeVerb("web", ["snap", "--interactive", "--root", "@e4", "--max-nodes", "50"], deps)
    await invokeVerb("web", ["eval", "document.title"], deps)
    await invokeVerb("web", ["batch", '[{"action":"click","ref":"@e1"}]'], deps)
    await invokeVerb("web", ["fetch", "https://api.example.com/me", "--headers", '{"accept":"application/json"}'], deps)
    await invokeVerb("web", ["handoff", "b-3", "--owner", "agent"], deps)

    expect(requests).toEqual([
      { method: "tab.list", params: { taskId: "task-42" } },
      { method: "tab.handoff", params: { id: "b-3", taskId: "task-42", owner: "human", reason: "Sign in" } },
      { method: "nav", params: { taskId: "task-42", url: "https://github.com/Sma1lboy/rove" } },
      { method: "snap", params: { taskId: "task-42", interactive: true, root: "@e4", maxNodes: 50 } },
      { method: "eval", params: { taskId: "task-42", expr: "document.title", awaitPromise: true } },
      { method: "batch", params: { taskId: "task-42", steps: [{ action: "click", ref: "@e1" }] } },
      {
        method: "fetch",
        params: { taskId: "task-42", url: "https://api.example.com/me", headers: { accept: "application/json" } },
      },
      { method: "tab.handoff", params: { id: "b-3", taskId: "task-42", owner: "agent" } },
    ])
  })

  it("reads batch steps from --steps-file", async () => {
    const { socketPath, requests } = await startFakeDesktopIpc(() => ({ ok: true }))
    const dir = mkdtempSync(join(tmpdir(), "rove-api-web-steps-"))
    dirs.push(dir)
    const stepsFile = join(dir, "steps.json")
    writeFileSync(
      stepsFile,
      JSON.stringify([
        { action: "wait", ms: 10 },
        { action: "snap", interactive: true },
      ]),
    )
    vi.stubEnv("ROVE_DESKTOP_BROWSER_SOCKET_PATH", socketPath)

    await invokeVerb("web", ["batch", "--steps-file", stepsFile], { client: null, runtime: stubRuntime() })
    expect(requests[0]?.params.steps).toEqual([
      { action: "wait", ms: 10 },
      { action: "snap", interactive: true },
    ])
  })

  it("returns DESKTOP_UNAVAILABLE when rove-desktop is not listening", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rove-api-web-absent-"))
    dirs.push(dir)
    vi.stubEnv("ROVE_DESKTOP_BROWSER_SOCKET_PATH", join(dir, "absent.sock"))
    await expectApiError(
      () => invokeVerb("web", ["tab", "list"], { client: null, runtime: stubRuntime() }),
      "DESKTOP_UNAVAILABLE",
    )
  })

  it("validates required flags and JSON payloads before opening the socket", async () => {
    const deps = { client: null, runtime: stubRuntime() }
    await expectApiError(() => invokeVerb("web", [], deps), "MISSING_FLAG")
    await expectApiError(() => invokeVerb("web", ["nav"], deps), "MISSING_FLAG")
    await expectApiError(() => invokeVerb("web", ["eval"], deps), "MISSING_FLAG")
    await expectApiError(() => invokeVerb("web", ["batch", "not-json"], deps), "BAD_FLAG")
    await expectApiError(() => invokeVerb("web", ["fetch", "https://x.test", "--headers", "[]"], deps), "BAD_FLAG")
  })

  it("defaultDesktopBrowserSocketPath matches the rove-desktop socket convention", () => {
    expect(defaultDesktopBrowserSocketPath("/tmp/r", "darwin")).toBe("/tmp/r/.rove/desktop-browser.sock")
    expect(defaultDesktopBrowserSocketPath("C:\\Users\\alice", "win32")).toMatch(
      /^\\\\\.\\pipe\\rove-[0-9a-f]{8}-desktop-browser$/,
    )
  })
})
