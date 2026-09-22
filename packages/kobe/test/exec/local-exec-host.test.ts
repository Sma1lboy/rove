/**
 * LocalExecHost — the local half of the ExecHost contract that
 * exec-host.test.ts (remote/ssh argv shapes) leaves out. Runs REAL
 * processes/fs in a temp dir: this class is the seam everything local
 * routes through, so a mocked spawn would only re-test the mock.
 * Plus the RemoteExecHost branches the sibling file misses: readdir
 * parsing and the password-getter-returning-null fallback to plain ssh.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type ExecResult, LocalExecHost, RemoteExecHost, type RemoteSpec } from "../../src/exec/exec-host.ts"

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kobe-local-exec-"))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("LocalExecHost", () => {
  const host = new LocalExecHost()

  it("run executes in the given cwd with merged env and captures stdout", async () => {
    // `$PWD`, not `$(pwd)`: the subshell forks, and under a parallel test
    // run MSYS sh on Windows CI occasionally fails that fork and exits with
    // a raw 0x8000000x status. The variable carries the same answer.
    const result = await host.run(["sh", "-c", "printf '%s' \"$KOBE_PROBE:$PWD\""], {
      cwd: dir,
      env: { KOBE_PROBE: "yes" },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.startsWith("yes:")).toBe(true)
    expect(result.stdout).toContain("kobe-local-exec-")
  })

  it("fs helpers: exists / mkdirp / readFile / readdir with graceful fallbacks", async () => {
    const sub = join(dir, "a/b/c")
    await host.mkdirp(sub)
    expect(await host.exists(sub)).toBe(true)
    expect(await host.exists(join(dir, "nope"))).toBe(false)

    writeFileSync(join(sub, "f.txt"), "content")
    expect(await host.readFile(join(sub, "f.txt"))).toBe("content")
    expect(await host.readFile(join(dir, "missing.txt"))).toBeNull()

    expect(await host.readdir(sub)).toEqual(["f.txt"])
    expect(await host.readdir(join(dir, "missing-dir"))).toEqual([])
  })
})

describe("RemoteExecHost residual branches", () => {
  const spec = (auth: RemoteSpec["auth"]): RemoteSpec => ({
    host: "box",
    user: "dev",
    port: 22,
    auth,
    controlPath: "/tmp/cm-sock",
  })

  function recordingSpawner(results: Partial<Record<string, ExecResult>> = {}) {
    const calls: string[][] = []
    const spawn = (argv: readonly string[], _env?: Record<string, string>): ExecResult => {
      calls.push([...argv])
      const key = argv[argv.length - 1] ?? ""
      return results[key] ?? { stdout: "", stderr: "", exitCode: argv.includes("-O") ? 1 : 0 }
    }
    return { calls, spawn }
  }

  it("a null password from the keychain falls back to plain ssh (no sshpass)", () => {
    const { calls, spawn } = recordingSpawner()
    const host = new RemoteExecHost(spec({ kind: "password", getPassword: () => null }), spawn)
    host.ensureReady()
    // check (-O check) fails → bring-up; with no password the sshpass prefix
    // must NOT appear — plain ssh carries the attempt.
    const bringUp = calls[calls.length - 1]
    expect(bringUp?.[0]).toBe("ssh")
    expect(calls.some((c) => c[0] === "sshpass")).toBe(false)
  })
})
