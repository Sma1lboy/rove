import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { rerunFailedChecks } from "@sma1lboy/rove-daemon/daemon/pr-rerun-checks"
import { frameToLine } from "@sma1lboy/rove-daemon/daemon/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const ROLLUP = JSON.stringify({
  statusCheckRollup: [
    { name: "lint", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://x/actions/runs/10/job/1" },
    { name: "test (a)", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://x/actions/runs/20/job/2" },
    { name: "test (b)", status: "COMPLETED", conclusion: "TIMED_OUT", detailsUrl: "https://x/actions/runs/20/job/3" },
    { name: "e2e", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://x/actions/runs/30/job/4" },
    { context: "preview-deploy", state: "ERROR", targetUrl: "https://deploy.example/1" },
  ],
})

/** Real spawns through a fake `gh` on PATH: answers `pr view` with {@link ROLLUP},
 *  logs every `run rerun`, and refuses run 30 when asked to. */
describe("rerunFailedChecks", () => {
  let binDir: string
  let cwd: string
  let calls: string
  let previousPath: string | undefined

  function fakeGh(refuseRun30: boolean, delaySeconds = 0): void {
    writeFileSync(join(binDir, "rollup.json"), ROLLUP)
    writeFileSync(
      join(binDir, "gh"),
      [
        "#!/bin/sh",
        `if [ "$1" = "pr" ]; then cat "${join(binDir, "rollup.json")}"; exit 0; fi`,
        `sleep ${delaySeconds}`,
        `echo "$*" >> "${calls}"`,
        refuseRun30 ? `if [ "$3" = "30" ]; then echo "run 30 cannot be rerun; it is in progress" >&2; exit 1; fi` : "",
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    )
  }

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), "rove-fake-gh-"))
    cwd = mkdtempSync(join(tmpdir(), "rove-gh-cwd-"))
    calls = join(binDir, "calls.log")
    writeFileSync(calls, "")
    previousPath = process.env.PATH
    process.env.PATH = `${binDir}:${previousPath ?? ""}`
  })

  afterEach(() => {
    process.env.PATH = previousPath ?? ""
    rmSync(binDir, { recursive: true, force: true })
    rmSync(cwd, { recursive: true, force: true })
  })

  it("restarts each failed run's failed jobs once, and counts the non-Actions check", async () => {
    fakeGh(false)
    const res = await rerunFailedChecks({ worktreePath: cwd, prNumber: 7 })

    // Run 20 failed twice (a matrix) and is restarted once; passing run 10 is left alone.
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(["run rerun 20 --failed", "run rerun 30 --failed"])
    expect(res).toEqual({ rerunRuns: 2, external: 1 })
  })

  it("delivers a slow rerun outcome without disconnecting the shared client", async () => {
    fakeGh(false, 0.1)
    vi.stubEnv("ROVE_RPC_TIMEOUT_MS", "40")
    const socketPath = join(cwd, "daemon.sock")
    let connections = 0
    let completed: Promise<void> = Promise.resolve()
    const server = createServer((socket) => {
      connections++
      socket.on("error", () => {})
      let buffer = ""
      socket.on("data", (data) => {
        buffer += data.toString()
        const newline = buffer.indexOf("\n")
        if (newline < 0) return
        const request = JSON.parse(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        completed = (async () => {
          const result = await rerunFailedChecks({ worktreePath: cwd, prNumber: 7 })
          if (socket.destroyed) return
          socket.write(frameToLine({ type: "event", name: "active-task", payload: { taskId: "t1" } }))
          socket.write(frameToLine({ type: "response", id: request.id, payload: result }))
        })()
      })
    })
    const client = new RoveDaemonClient(socketPath)
    let closes = 0
    let activeTask: unknown
    client.onLifecycle("close", () => closes++)
    client.on("active-task", (frame) => {
      activeTask = frame.payload
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(socketPath, resolve)
      })
      await expect(client.request("pr.rerunFailedChecks", { taskId: "t1" })).resolves.toEqual({
        rerunRuns: 2,
        external: 1,
      })
      expect(closes).toBe(0)
      expect(connections).toBe(1)
      expect(activeTask).toEqual({ taskId: "t1" })
      expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(["run rerun 20 --failed", "run rerun 30 --failed"])
    } finally {
      client.close()
      await completed
      await new Promise<void>((resolve) => server.close(() => resolve()))
      vi.unstubAllEnvs()
    }
  })

  it("keeps going past a run gh refuses, and quotes the refusal", async () => {
    fakeGh(true)
    const res = await rerunFailedChecks({ worktreePath: cwd, prNumber: 7 })

    expect(res.rerunRuns).toBe(1)
    expect(res.refused).toContain("in progress")
  })
})
