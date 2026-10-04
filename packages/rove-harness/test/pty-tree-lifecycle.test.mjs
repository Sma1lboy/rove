import { once } from "node:events"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { spawn } from "node-pty"
import { WebSocket, WebSocketServer } from "ws"
import { expect, it } from "vitest"
import { createScrollback } from "../pty-scrollback.mjs"
import { createPtySessionManager } from "../pty-session-lifecycle.mjs"
import { killPtyTree } from "../pty-tree-kill.mjs"

const fixture = fileURLToPath(new URL("./fixtures/pty-process-tree.mjs", import.meta.url))

async function until(predicate) {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for PTY lifecycle")
    await delay(10)
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code !== "ESRCH") throw error
    return false
  }
}

it.skipIf(process.platform === "win32")("reconnects to a real PTY, then reaps session descendants but preserves detached services after grace and shutdown", async () => {
  let now = 0
  const timers = new Set()
  function advance(ms) {
    now += ms
    for (const timer of timers) {
      if (timer.at > now) continue
      timers.delete(timer)
      timer.cb()
    }
  }
  const ptys = []
  const manager = createPtySessionManager({
    fetchSpec: async () => ({ cwd: process.cwd(), command: ["/bin/bash", "-c", 'set -m; "$@" & wait', "fixture", process.execPath, fixture] }),
    spawnPty: (...args) => {
      const pty = spawn(...args)
      ptys.push(pty)
      return pty
    },
    terminatePty: killPtyTree,
    createScrollback,
    scrollbackCap: 4096,
    env: process.env,
    setTimeoutFn: (cb, ms) => {
      const timer = { cb, at: now + ms }
      timers.add(timer)
      return timer
    },
    clearTimeoutFn: (timer) => timers.delete(timer),
  })
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
  const clients = []
  let attached = 0
  let closed = 0
  server.on("connection", (ws) => {
    ws.on("close", () => { closed++ })
    void manager.attachSocket({ ws, tabId: "tab", taskId: "task", mode: "shell", cols: 80, rows: 24 })
      .then(() => { attached++ })
  })
  await once(server, "listening")
  async function connect() {
    let output = ""
    const previous = attached
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}`)
    clients.push(ws)
    ws.on("message", (chunk) => { output += chunk.toString() })
    await until(() => attached > previous && [...output.matchAll(/TREE_PID=(\d+)\r?\n/g)].length === 3 && /SERVICE_PID=\d+\r?\n/.test(output))
    return {
      ws,
      pids: [ptys.at(-1).pid, ...[...output.matchAll(/TREE_PID=(\d+)\r?\n/g)].map((match) => Number(match[1]))],
      service: Number(output.match(/SERVICE_PID=(\d+)\r?\n/)[1]),
    }
  }
  const owned = new Set()
  try {
    const first = await connect()
    first.pids.forEach((pid) => owned.add(pid))
    owned.add(first.service)
    first.ws.terminate()
    await until(() => closed === 1)
    advance(60_000)
    expect(first.pids.every(alive)).toBe(true)
    const second = await connect()
    expect(second.pids).toEqual(first.pids)
    expect(ptys).toHaveLength(1)
    advance(10 * 60_000)
    expect(first.pids.every(alive)).toBe(true)

    second.ws.terminate()
    await until(() => closed === 2)
    advance(10 * 60_000 - 1)
    expect(first.pids.every(alive)).toBe(true)
    advance(1)
    await until(() => first.pids.every((pid) => !alive(pid)))
    expect(manager.sessionCount()).toBe(0)
    expect(alive(first.service)).toBe(true)

    const third = await connect()
    third.pids.forEach((pid) => owned.add(pid))
    owned.add(third.service)
    expect(ptys).toHaveLength(2)
    manager.shutdown()
    await until(() => third.pids.every((pid) => !alive(pid)))
    expect(timers.size).toBe(0)
    expect(alive(third.service)).toBe(true)
  } finally {
    manager.shutdown()
    for (const client of clients) client.terminate()
    for (const pty of ptys) if (alive(pty.pid)) killPtyTree(pty)
    for (const pid of owned) if (alive(pid)) process.kill(pid, "SIGKILL")
    await new Promise((resolve) => server.close(resolve))
  }
}, 20_000)
