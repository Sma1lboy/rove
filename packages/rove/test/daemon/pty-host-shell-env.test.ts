/**
 * The fallback shell `keepAlive` execs after an engine exits is `${SHELL:-/bin/sh}`. A PTY host started
 * without $SHELL (a detached daemon, a harness) must still hand its children one, or a shell-function
 * engine preset such as `claudecpa` is undefined in that shell.
 */

import { resolveSessionShell } from "@sma1lboy/rove-daemon/daemon/platform-shell"
import type { PtyChild, PtyDriver } from "@sma1lboy/rove-daemon/daemon/pty-driver"
import { PtyHost } from "@sma1lboy/rove-daemon/daemon/pty-host"
import { afterEach, describe, expect, it, vi } from "vitest"

function spawnedEnv(): Readonly<Record<string, string | undefined>> {
  let env: Readonly<Record<string, string | undefined>> = {}
  const driver: PtyDriver = (request) => {
    env = request.env
    return {
      pid: 1,
      exited: Promise.withResolvers<never>().promise,
      write() {},
      resize() {},
      close() {},
      kill() {},
    } as unknown as PtyChild
  }
  new PtyHost({ driver }).open("t::tab-1", { cwd: "/tmp", command: ["/bin/sh", "-ilc", "true"] }, {}, () => {})
  return env
}

describe("hosted session environment", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("gets the session shell as $SHELL when the host has none", () => {
    vi.stubEnv("SHELL", "")
    expect(spawnedEnv().SHELL).toBe(resolveSessionShell({ env: {} }))
  })

  it("keeps the $SHELL the host has", () => {
    vi.stubEnv("SHELL", "/usr/local/bin/fish")
    expect(spawnedEnv().SHELL).toBe("/usr/local/bin/fish")
  })
})
