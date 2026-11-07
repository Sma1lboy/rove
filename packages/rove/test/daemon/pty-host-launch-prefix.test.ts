/**
 * A task directory holding `.rove-launch.json` (a workspace whose files live in a container) gets every child
 * the PTY host spawns there wrapped by its prefix, and its `reap` run once the child is gone, both carrying one
 * id per spawn.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { PtyChild, PtyDriver } from "@sma1lboy/rove-daemon/daemon/pty-driver"
import { PtyHost } from "@sma1lboy/rove-daemon/daemon/pty-host"
import { afterEach, expect, it, vi } from "vitest"

let dir: string
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

it("wraps the child in the directory's launch prefix and reaps after it exits", async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rove-launch-"))
  const reaped = path.join(dir, "reaped")
  fs.writeFileSync(
    path.join(dir, ".rove-launch.json"),
    JSON.stringify({
      prefix: ["wrap", "--id={launch}"],
      reap: ["/bin/sh", "-c", 'echo "$1" > "$2"', "sh", "{launch}", reaped],
    }),
  )
  let argv: readonly string[] = []
  const exit = Promise.withResolvers<{ exitCode: number }>()
  const driver: PtyDriver = (request) => {
    argv = request.argv
    return { pid: 1, exited: exit.promise, write() {}, resize() {}, close() {}, kill() {} } as unknown as PtyChild
  }
  new PtyHost({ driver }).open("t::tab-1", { cwd: dir, command: ["bash"] }, {}, () => {})

  const id = (argv[1] as string).replace("--id=", "")
  expect(argv).toEqual(["wrap", `--id=${id}`, "bash"])
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
  exit.resolve({ exitCode: 0 })
  await vi.waitFor(() => expect(fs.readFileSync(reaped, "utf8").trim()).toBe(id), { timeout: 5000 })
})

it("leaves a child in a plain directory unwrapped", () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rove-launch-"))
  let argv: readonly string[] = []
  const driver: PtyDriver = (request) => {
    argv = request.argv
    return {
      pid: 1,
      exited: new Promise(() => {}),
      write() {},
      resize() {},
      close() {},
      kill() {},
    } as unknown as PtyChild
  }
  new PtyHost({ driver }).open("t::tab-1", { cwd: dir, command: ["bash"] }, {}, () => {})
  expect(argv).toEqual(["bash"])
})
