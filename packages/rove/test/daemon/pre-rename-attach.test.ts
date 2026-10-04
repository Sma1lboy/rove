import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RoveDaemonClient } from "@sma1lboy/rove-daemon/client"
import { defaultPtyHostSocketPath, windowsPipePath } from "@sma1lboy/rove-daemon/daemon/paths"
import { preRenameRuntimePaths, preRenameStateDir } from "@sma1lboy/rove-daemon/daemon/pre-rename-runtime"
import { startPtyHostServer } from "@sma1lboy/rove-daemon/daemon/pty-server"
import { afterEach, expect, test } from "vitest"

const homes: string[] = []
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

test("a client attaches to the old address only while no canonical host is listening", async () => {
  const home = await mkdtemp(join(tmpdir(), "rove-attach-"))
  homes.push(home)
  await mkdir(preRenameStateDir(home), { recursive: true })
  const canonical = defaultPtyHostSocketPath(home)
  const legacy = preRenameRuntimePaths(canonical)[0]!
  const old = await startPtyHostServer({ socketPath: legacy, pidPath: join(home, "old.pid"), freezeDir: join(home, "old-freeze"), version: "before" })
  const before = new RoveDaemonClient(canonical)
  try {
    const result = await before.request<{ version: string }>("pty.list")
    expect(result.version).toBe("before")
  } finally {
    before.close()
  }
  const current = await startPtyHostServer({ socketPath: canonical, pidPath: join(home, "new.pid"), freezeDir: join(home, "new-freeze"), version: "after" })
  const after = new RoveDaemonClient(canonical)
  try {
    const result = await after.request<{ version: string }>("pty.list")
    expect(result.version).toBe("after")
  } finally {
    after.close()
    await current.close()
    await old.close()
  }
})

test("Windows and long Unix addresses have read-only legacy candidates", () => {
  const windows = windowsPipePath("C:\\fixture", "pty")
  expect(windows).toMatch(/^\\\\\.\\pipe\\rove-/)
  expect(preRenameRuntimePaths(windows)).toHaveLength(1)
  expect(preRenameRuntimePaths(windows)[0]).not.toBe(windows)
  expect(preRenameRuntimePaths("/tmp/rove-01234567-pty.sock")).toHaveLength(1)
  expect(preRenameRuntimePaths("/run/user/123/rove-pty.sock")).toHaveLength(1)
  expect(preRenameRuntimePaths("/run/user/123/rove.sock")).toHaveLength(1)
  expect(preRenameRuntimePaths("/tmp/unrelated.sock")).toEqual([])
})
