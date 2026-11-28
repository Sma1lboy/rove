import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { createConnection } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type BrowserIpcHandler, type BrowserIpcServer, startBrowserIpcServer } from "../src/browser-ipc"
import { type IpcResponse, desktopBrowserSocketPath, validateBrowserUrl } from "../src/browser-protocol"

function sendLine(socketPath: string, payload: unknown): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(socketPath)
    let buf = ""
    sock.setEncoding("utf8")
    sock.once("error", reject)
    sock.once("connect", () => sock.write(`${JSON.stringify(payload)}\n`))
    sock.on("data", (chunk: string) => {
      buf += chunk
      const nl = buf.indexOf("\n")
      if (nl === -1) return
      sock.destroy()
      resolve(JSON.parse(buf.slice(0, nl)) as IpcResponse)
    })
  })
}

const dirs: string[] = []
const servers: BrowserIpcServer[] = []

afterEach(async () => {
  while (servers.length) await servers.pop()!.close()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe("browser-ipc", () => {
  test("routes tab, nav, snap, eval, batch, fetch, and handoff over a local socket", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rove-desktop-ipc-"))
    dirs.push(dir)
    const socketPath = join(dir, "browser.sock")
    const calls: Array<{ method: string; arg: unknown }> = []

    const handler: BrowserIpcHandler = {
      listTabs: (taskId) => {
        calls.push({ method: "tab.list", arg: taskId })
        return { tabs: [{ id: "b-1", url: "https://example.com", owner: "human" }], activeTabId: "b-1" }
      },
      newTab: (opts) => {
        calls.push({ method: "tab.new", arg: opts })
        return { id: "b-2", url: opts.url ?? "", owner: opts.owner ?? "agent" }
      },
      closeTab: (id) => {
        calls.push({ method: "tab.close", arg: id })
        if (id === "missing") throw new Error("TAB_NOT_FOUND: no such tab")
        return { closed: true, id }
      },
      focusTab: (id) => ({ id, visible: true }),
      handoffTab: (opts) => ({ id: opts.id ?? "b-1", owner: opts.owner ?? "human", previousOwner: "agent" }),
      navigate: (opts) => ({ id: opts.id ?? "b-1", url: opts.url ?? "https://example.com", go: opts.go }),
      snap: (opts) => ({
        id: opts.id ?? "b-1",
        interactive: opts.interactive,
        root: opts.root,
        text: '@e1 [button] "Go"',
        nodes: [],
      }),
      eval: (opts) => ({ id: opts.id ?? "b-1", value: opts.expr }),
      batch: (opts) => ({
        id: opts.id ?? "b-1",
        ok: true,
        completed: opts.steps.length,
        total: opts.steps.length,
        results: [],
      }),
      fetch: (opts) => ({ id: opts.id ?? "b-1", url: opts.url, status: 200, ok: true, body: "{}" }),
    }

    servers.push(await startBrowserIpcServer(handler, { socketPath }))

    const listed = await sendLine(socketPath, { id: "1", method: "tab.list", params: { taskId: "t-1" } })
    expect(listed).toEqual({
      id: "1",
      ok: true,
      result: { tabs: [{ id: "b-1", url: "https://example.com", owner: "human" }], activeTabId: "b-1" },
    })

    const snapped = await sendLine(socketPath, {
      id: "2",
      method: "snap",
      params: { id: "b-1", interactive: true, root: "@e2" },
    })
    expect(snapped.ok).toBe(true)
    if (snapped.ok) expect(snapped.result).toMatchObject({ interactive: true, root: "@e2" })

    const handed = await sendLine(socketPath, {
      id: "3",
      method: "tab.handoff",
      params: { id: "b-1", owner: "human", reason: "2FA login" },
    })
    expect(handed).toEqual({
      id: "3",
      ok: true,
      result: { id: "b-1", owner: "human", previousOwner: "agent" },
    })

    const missing = await sendLine(socketPath, { id: "4", method: "tab.close", params: { id: "missing" } })
    expect(missing).toEqual({
      id: "4",
      ok: false,
      error: { code: "TAB_NOT_FOUND", message: "no such tab" },
    })

    const unknown = await sendLine(socketPath, { id: "5", method: "bogus" })
    expect(unknown).toEqual({
      id: "5",
      ok: false,
      error: { code: "UNKNOWN_METHOD", message: 'unsupported browser IPC method "bogus"' },
    })
  })
})

describe("browser-protocol", () => {
  test("validateBrowserUrl allows http/https and blocks dangerous schemes and Rove's bridge origin", () => {
    expect(validateBrowserUrl("https://github.com/Sma1lboy/rove", "http://127.0.0.1:7890").href).toBe(
      "https://github.com/Sma1lboy/rove",
    )
    expect(validateBrowserUrl("http://localhost:3000/app", "http://127.0.0.1:7890").href).toBe(
      "http://localhost:3000/app",
    )
    expect(() => validateBrowserUrl("http://127.0.0.1:7890/#token=secret", "http://127.0.0.1:7890")).toThrow(
      /bridge origin/,
    )
    expect(() => validateBrowserUrl("javascript:alert(1)", null)).toThrow(/unsupported URL scheme/)
    expect(() => validateBrowserUrl("file:///etc/passwd", null)).toThrow(/unsupported URL scheme/)
  })

  test("desktopBrowserSocketPath fits long paths and uses named pipes on Windows", () => {
    const short = desktopBrowserSocketPath("/tmp/r", "darwin")
    expect(short).toBe("/tmp/r/.rove/desktop-browser.sock")
    const deep = desktopBrowserSocketPath(`/tmp/${"a".repeat(120)}`, "darwin")
    expect(Buffer.byteLength(deep, "utf8")).toBeLessThanOrEqual(100)
    expect(deep).toContain("-desktop-browser.sock")
    expect(desktopBrowserSocketPath("C:\\Users\\alice", "win32")).toMatch(
      /^\\\\\.\\pipe\\rove-[0-9a-f]{8}-desktop-browser$/,
    )
  })
})
