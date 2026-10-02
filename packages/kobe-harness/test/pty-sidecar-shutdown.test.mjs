import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { WebSocket } from "ws"
import { expect, it } from "vitest"

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code !== "ESRCH") throw error
    return false
  }
}

it("closes tab sessions and exits through the parent pipe without killing detached services", async () => {
  const home = mkdtempSync(join(tmpdir(), "rove-sidecar-"))
  mkdirSync(join(home, ".rove"))
  writeFileSync(join(home, ".rove", "web-token"), "test-token")
  const fixture = fileURLToPath(new URL("./fixtures/pty-process-tree.mjs", import.meta.url))
  const quote = (value) => `'${value.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`
  const sidecar = spawn(process.execPath, [fileURLToPath(new URL("../pty-server.mjs", import.meta.url))], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ROVE_HOME_DIR: home,
      KOBE_HOME_DIR: home,
      KOBE_WEB_HOST: "127.0.0.1",
      KOBE_PTY_PORT: "0",
      KOBE_PTY_PARENT_PIPE: "1",
      KOBE_PTY_DEV_SHELL: process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/sh",
      KOBE_PTY_DEV_COMMAND: `exec ${quote(process.execPath)} ${quote(fixture)}`,
    },
  })
  const exited = once(sidecar, "exit")
  let logs = ""
  sidecar.stdout.on("data", (chunk) => { logs += chunk })
  sidecar.stderr.on("data", (chunk) => { logs += chunk })
  async function until(predicate) {
    const deadline = Date.now() + 15_000
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`Sidecar timed out: ${logs}`)
      await delay(20)
    }
  }
  const owned = new Set()
  const clients = []
  async function connect(port, tab) {
    let output = ""
    const ws = new WebSocket(`ws://127.0.0.1:${port}/pty?tab=${tab}&taskId=test&token=test-token`)
    clients.push(ws)
    ws.on("message", (chunk) => {
      output += chunk
      for (const match of output.matchAll(/(?:TREE|SERVICE)_PID=(\d+)\r?\n/g)) owned.add(Number(match[1]))
    })
    await until(() => [...output.matchAll(/TREE_PID=(\d+)\r?\n/g)].length === 3 && /SERVICE_PID=\d+\r?\n/.test(output))
    return {
      pids: [...output.matchAll(/TREE_PID=(\d+)\r?\n/g)].map((match) => Number(match[1])),
      service: Number(output.match(/SERVICE_PID=(\d+)\r?\n/)[1]),
    }
  }
  try {
    await until(() => /listening on 127\.0\.0\.1:(\d+)/.test(logs))
    const port = Number(logs.match(/listening on 127\.0\.0\.1:(\d+)/)[1])
    const first = await connect(port, "first")
    const response = await fetch(`http://127.0.0.1:${port}/pty/close`, {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ tab: "first" }),
    })
    expect(response.ok).toBe(true)
    await until(() => first.pids.every((pid) => !alive(pid)))
    expect(alive(first.service)).toBe(true)

    const second = await connect(port, "second")
    sidecar.stdin.end()
    await until(() => sidecar.exitCode !== null)
    expect(await exited).toEqual([0, null])
    await until(() => second.pids.every((pid) => !alive(pid)))
    expect(alive(first.service)).toBe(true)
    expect(alive(second.service)).toBe(true)
  } finally {
    for (const ws of clients) ws.terminate()
    sidecar.stdin.end()
    if (sidecar.exitCode === null) sidecar.kill()
    await exited
    for (const pid of owned) if (alive(pid)) process.kill(pid, "SIGKILL")
  }
}, 45_000)
