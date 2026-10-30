/** Telling a running engine from the newer CLI installed under its name since it started. */

import { execFileSync, spawn } from "node:child_process"
import { chmod, mkdir, mkdtemp, rename, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { describe, expect, it } from "vitest"
import { defaultEngineUpdateDeps, engineUpdates, parseEtime } from "../../src/engine/engine-update.ts"

it("compares a live versioned process with the launch symlink, and never treats chmod as an upgrade", async () => {
  const root = await mkdtemp(join(tmpdir(), "rove-installation-"))
  const v1 = join(root, "v1", "claude.js")
  const v2 = join(root, "v2", "claude.js")
  const launch = join(root, "claude")
  await mkdir(join(root, "v1"))
  await mkdir(join(root, "v2"))
  await writeFile(v1, "console.log('ready'); setInterval(() => {}, 1000)")
  await symlink(v1, launch)
  await delay(2200)
  const child = spawn("bun", [v1], { stdio: ["ignore", "pipe", "pipe"] })
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", () => resolve())
      child.once("error", reject)
    })
    if (!child.pid) throw new Error("child has no pid")
    const engines = new Map([["tab", { pid: child.pid, argv: `bun ${v1}`, launchArgv: ["claude"] }]])
    const deps = {
      ...defaultEngineUpdateDeps,
      which: () => launch,
      elapsed: async (pids: readonly number[]) =>
        execFileSync("ps", ["-o", "pid=,etime=", "-p", pids.join(",")], { encoding: "utf8" }),
    }
    expect((await engineUpdates(engines, deps)).get("tab")).toBe(false)
    await delay(2200)
    await chmod(v1, 0o700)
    expect((await engineUpdates(engines, deps)).get("tab")).toBeNull()
    await writeFile(v2, "setInterval(() => {}, 2000)")
    await symlink(v2, join(root, "next"))
    await rename(join(root, "next"), launch)
    expect((await engineUpdates(engines, deps)).get("tab")).toBe(true)
    expect((await engineUpdates(engines, { ...deps, which: () => null })).get("tab")).toBeNull()
    expect((await engineUpdates(new Map([["tab", { pid: child.pid, argv: `bun ${v1}` }]]), deps)).get("tab")).toBeNull()
  } finally {
    child.kill()
  }
}, 15000)

it("keeps unavailable process and installation evidence unknown", async () => {
  const engines = new Map([
    ["tab", { pid: 123, argv: "claude", launchArgv: ["claude"] }],
    ["missing", null],
  ])
  const deps = {
    ...defaultEngineUpdateDeps,
    elapsed: async () => {
      throw new Error("unavailable")
    },
  }
  expect([...(await engineUpdates(engines, deps)).values()]).toEqual([null, null])
})

describe("parseEtime", () => {
  it("reads every POSIX elapsed-time form", () => {
    expect(parseEtime("05:09")).toBe(309)
    expect(parseEtime("02:05:09")).toBe(2 * 3600 + 309)
    expect(parseEtime("3-02:05:09")).toBe(3 * 86400 + 2 * 3600 + 309)
    expect(parseEtime("soon")).toBeNull()
  })
})
